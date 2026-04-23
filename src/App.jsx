import { useEffect, useMemo, useState } from 'react'

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0) || ''
  const delimiters = ['\t', ';', ',']

  let best = '\t'
  let bestCount = -1

  for (const delimiter of delimiters) {
    const count = firstLine.split(delimiter).length
    if (count > bestCount) {
      best = delimiter
      bestCount = count
    }
  }

  return best
}

function parseDelimitedText(text) {
  const delimiter = detectDelimiter(text)
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)

  if (!lines.length) {
    return { headers: [], rows: [], delimiter }
  }

  const headers = lines[0].split(delimiter).map((item) => item.trim())
  const rows = lines.slice(1).map((line, index) => {
    const values = line.split(delimiter)
    const row = {}

    headers.forEach((header, headerIndex) => {
      row[header] = (values[headerIndex] ?? '').trim()
    })

    row.__index = index
    return row
  })

  return { headers, rows, delimiter }
}

function chooseDefaultKey(headers) {
  const priority = ['id', 'Id', 'ID', 'key', 'Key', 'name', 'Name', 'skill', 'Treasure Class']
  return priority.find((item) => headers.includes(item)) || headers[0] || ''
}

function makeBaseKey(row, selectedKeys, fallbackIndex) {
  const usableKeys = selectedKeys.filter(Boolean)

  if (usableKeys.length) {
    return usableKeys.map((key) => row[key] ?? '').join('§')
  }

  return `__row_${fallbackIndex}`
}

function indexRows(rows, selectedKeys) {
  const grouped = new Map()

  rows.forEach((row, index) => {
    const baseKey = makeBaseKey(row, selectedKeys, index)
    if (!grouped.has(baseKey)) {
      grouped.set(baseKey, [])
    }
    grouped.get(baseKey).push(row)
  })

  const duplicateKeys = new Set(
    Array.from(grouped.entries())
      .filter(([, groupedRows]) => groupedRows.length > 1)
      .map(([baseKey]) => baseKey),
  )

  return { grouped, duplicateKeys }
}

function diffDatasets(leftData, rightData, selectedKeys) {
  const leftIndex = indexRows(leftData.rows, selectedKeys)
  const rightIndex = indexRows(rightData.rows, selectedKeys)

  const allHeaders = Array.from(new Set([...leftData.headers, ...rightData.headers]))
  const addedColumns = rightData.headers.filter((header) => !leftData.headers.includes(header))
  const removedColumns = leftData.headers.filter((header) => !rightData.headers.includes(header))

  const allBaseKeys = Array.from(new Set([...leftIndex.grouped.keys(), ...rightIndex.grouped.keys()]))
  const diffRows = []

  for (const baseKey of allBaseKeys) {
    const leftRows = leftIndex.grouped.get(baseKey) || []
    const rightRows = rightIndex.grouped.get(baseKey) || []
    const maxLength = Math.max(leftRows.length, rightRows.length)

    for (let occurrence = 0; occurrence < maxLength; occurrence += 1) {
      const leftRow = leftRows[occurrence]
      const rightRow = rightRows[occurrence]
      const rowKey = `${baseKey}#${occurrence}`

      if (!leftRow && rightRow) {
        diffRows.push({
          rowKey,
          type: 'added',
          values: rightRow,
          modifiedCells: new Set(),
          leftRowNumber: '',
          rightRowNumber: rightRow.__index + 1,
          displayRowNumber: rightRow.__index + 1,
        })
        continue
      }

      if (leftRow && !rightRow) {
        diffRows.push({
          rowKey,
          type: 'deleted',
          values: leftRow,
          modifiedCells: new Set(),
          leftRowNumber: leftRow.__index + 1,
          rightRowNumber: '',
          displayRowNumber: leftRow.__index + 1,
        })
        continue
      }

      const modifiedCells = new Set()
      let changed = false

      for (const header of allHeaders) {
        const leftValue = leftRow?.[header] ?? ''
        const rightValue = rightRow?.[header] ?? ''
        if (leftValue !== rightValue) {
          changed = true
          modifiedCells.add(header)
        }
      }

      if (changed) {
        diffRows.push({
          rowKey,
          type: 'modified',
          values: rightRow,
          previousValues: leftRow,
          modifiedCells,
          leftRowNumber: leftRow.__index + 1,
          rightRowNumber: rightRow.__index + 1,
          displayRowNumber: leftRow.__index + 1,
        })
      }
    }
  }

  return {
    allHeaders,
    addedColumns,
    removedColumns,
    diffRows,
    duplicateKeys: Array.from(new Set([...leftIndex.duplicateKeys, ...rightIndex.duplicateKeys])).sort(),
  }
}

async function readFiles(files) {
  const loaded = await Promise.all(
    Array.from(files).map(async (file) => {
      const text = await file.text()
      return {
        fileName: file.name,
        ...parseDelimitedText(text),
      }
    }),
  )

  return loaded
}

function MultipleFilePicker({ label, onLoaded }) {
  async function handleChange(event) {
    const files = event.target.files
    if (!files?.length) {
      onLoaded([])
      return
    }

    const loadedFiles = await readFiles(files)
    onLoaded(loadedFiles)
  }

  return (
    <label className="file-picker">
      <span>{label}</span>
      <input type="file" accept=".txt,.csv,text/plain" multiple onChange={handleChange} />
    </label>
  )
}

function ComparisonPanel({
  comparison,
  index,
  leftLabel,
  rightLabel,
  selectedKeys,
  onToggleKey,
}) {
  const summary = {
    addedRows: comparison.diffResult.diffRows.filter((row) => row.type === 'added').length,
    deletedRows: comparison.diffResult.diffRows.filter((row) => row.type === 'deleted').length,
    modifiedRows: comparison.diffResult.diffRows.filter((row) => row.type === 'modified').length,
    addedColumns: comparison.diffResult.addedColumns.length,
  }

  return (
    <details className="comparison-panel panel" open={index === 0}>
      <summary className="comparison-summary">
        <div>
          <strong>{comparison.fileName}</strong>
          <span className="comparison-subtitle">
            {leftLabel}: {comparison.leftFileName} → {rightLabel}: {comparison.rightFileName}
          </span>
        </div>
        <div className="comparison-badges">
          <span className="badge badge-added">+ rows: {summary.addedRows}</span>
          <span className="badge badge-deleted">- rows: {summary.deletedRows}</span>
          <span className="badge badge-modified">~ rows: {summary.modifiedRows}</span>
          <span className="badge badge-neutral">+ cols: {summary.addedColumns}</span>
        </div>
      </summary>

      <div className="comparison-content">
        <section className="summary-grid compact-gap">
          <div className="summary-card added-card">
            <span className="summary-label">Added rows</span>
            <strong>{summary.addedRows}</strong>
          </div>
          <div className="summary-card deleted-card">
            <span className="summary-label">Deleted rows</span>
            <strong>{summary.deletedRows}</strong>
          </div>
          <div className="summary-card modified-card">
            <span className="summary-label">Modified rows</span>
            <strong>{summary.modifiedRows}</strong>
          </div>
          <div className="summary-card neutral-card">
            <span className="summary-label">Added columns</span>
            <strong>{summary.addedColumns}</strong>
          </div>
        </section>

        <section className="notes comparison-notes">
          <p><strong>Green row</strong> = added row</p>
          <p><strong>Red row</strong> = deleted row</p>
          <p><strong>Yellow cell</strong> = modified value</p>
          <p><strong>Green header</strong> = added column</p>
          <p><strong>Matching keys:</strong> {selectedKeys.length ? selectedKeys.join(', ') : 'Row order only'}</p>
          {comparison.diffResult.removedColumns.length > 0 && (
            <p><strong>Removed columns:</strong> {comparison.diffResult.removedColumns.join(', ')}</p>
          )}
          {comparison.diffResult.duplicateKeys.length > 0 && (
            <p>
              <strong>Duplicate row keys detected:</strong> {comparison.diffResult.duplicateKeys.slice(0, 8).join(', ')}
              {comparison.diffResult.duplicateKeys.length > 8 ? ` and ${comparison.diffResult.duplicateKeys.length - 8} more` : ''}
              . Duplicates are compared in occurrence order within each key.
            </p>
          )}
        </section>

        <details className="panel advanced-panel" open={false}>
          <summary className="advanced-summary">Advanced: Row matching keys</summary>
          <p className="advanced-copy">
            The app auto-selects a likely key for this file. Change it here only if this panel is matching rows incorrectly.
          </p>
          <div className="key-list">
            {comparison.availableKeys.map((header) => (
              <label key={`${comparison.fileName}-${header}`} className="checkbox-pill">
                <input
                  type="checkbox"
                  checked={selectedKeys.includes(header)}
                  onChange={() => onToggleKey(comparison.fileName, header)}
                />
                <span>{header}</span>
              </label>
            ))}
          </div>
        </details>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Row #</th>
                {comparison.diffResult.allHeaders.map((header) => (
                  <th
                    key={header}
                    className={comparison.diffResult.addedColumns.includes(header) ? 'column-added' : ''}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparison.diffResult.diffRows.length === 0 ? (
                <tr>
                  <td colSpan={comparison.diffResult.allHeaders.length + 2} className="empty-state">
                    No differences found.
                  </td>
                </tr>
              ) : (
                comparison.diffResult.diffRows.map((row) => (
                  <tr key={row.rowKey} className={`row-${row.type}`}>
                    <td className="status-cell">{row.type}</td>
                    <td className="row-number-cell">{row.displayRowNumber}</td>
                    {comparison.diffResult.allHeaders.map((header) => {
                      const isModified = row.type === 'modified' && row.modifiedCells.has(header)
                      const currentValue = row.values?.[header] ?? ''
                      const previousValue = row.previousValues?.[header] ?? ''

                      return (
                        <td key={`${row.rowKey}-${header}`} className={isModified ? 'cell-modified' : ''}>
                          {isModified ? (
                            <div className="cell-diff">
                              <span className="old-value">{previousValue}</span>
                              <span className="arrow">→</span>
                              <span className="new-value">{currentValue}</span>
                            </div>
                          ) : (
                            currentValue
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  )
}

export default function App() {
  const [leftFiles, setLeftFiles] = useState([])
  const [rightFiles, setRightFiles] = useState([])
  const [selectedKeysByFile, setSelectedKeysByFile] = useState({})

  const matchedComparisons = useMemo(() => {
    if (!leftFiles.length || !rightFiles.length) return []

    const leftByName = new Map(leftFiles.map((file) => [file.fileName, file]))
    const rightByName = new Map(rightFiles.map((file) => [file.fileName, file]))
    const matchedNames = Array.from(leftByName.keys()).filter((name) => rightByName.has(name)).sort()

    return matchedNames.map((fileName) => {
      const leftData = leftByName.get(fileName)
      const rightData = rightByName.get(fileName)
      const availableKeys = Array.from(new Set([...leftData.headers, ...rightData.headers]))

      return {
        fileName,
        leftFileName: fileName,
        rightFileName: fileName,
        leftData,
        rightData,
        availableKeys,
      }
    })
  }, [leftFiles, rightFiles])

  useEffect(() => {
    setSelectedKeysByFile((current) => {
      const next = {}

      matchedComparisons.forEach((comparison) => {
        const availableKeys = comparison.availableKeys
        const currentKeys = current[comparison.fileName] || []
        const stillValidKeys = currentKeys.filter((key) => availableKeys.includes(key))

        if (stillValidKeys.length > 0) {
          next[comparison.fileName] = stillValidKeys
          return
        }

        const defaultKey = chooseDefaultKey(availableKeys)
        next[comparison.fileName] = defaultKey ? [defaultKey] : []
      })

      const changed = JSON.stringify(current) !== JSON.stringify(next)
      return changed ? next : current
    })
  }, [matchedComparisons])

  const comparisons = useMemo(() => {
    return matchedComparisons.map((comparison) => ({
      fileName: comparison.fileName,
      leftFileName: comparison.leftFileName,
      rightFileName: comparison.rightFileName,
      availableKeys: comparison.availableKeys,
      selectedKeys: selectedKeysByFile[comparison.fileName] || [],
      diffResult: diffDatasets(
        comparison.leftData,
        comparison.rightData,
        selectedKeysByFile[comparison.fileName] || [],
      ),
    }))
  }, [matchedComparisons, selectedKeysByFile])

  const visibleComparisons = useMemo(() => {
    return comparisons.filter((comparison) => {
      const { diffResult } = comparison
      return (
        diffResult.diffRows.length > 0 ||
        diffResult.addedColumns.length > 0 ||
        diffResult.removedColumns.length > 0
      )
    })
  }, [comparisons])

  const unmatchedLeftFiles = useMemo(() => {
    const rightNames = new Set(rightFiles.map((file) => file.fileName))
    return leftFiles.filter((file) => !rightNames.has(file.fileName)).map((file) => file.fileName).sort()
  }, [leftFiles, rightFiles])

  const unmatchedRightFiles = useMemo(() => {
    const leftNames = new Set(leftFiles.map((file) => file.fileName))
    return rightFiles.filter((file) => !leftNames.has(file.fileName)).map((file) => file.fileName).sort()
  }, [leftFiles, rightFiles])

  function toggleKey(fileName, header) {
    setSelectedKeysByFile((current) => {
      const activeKeys = current[fileName] || []
      const nextKeys = activeKeys.includes(header)
        ? activeKeys.filter((item) => item !== header)
        : [...activeKeys, header]

      return {
        ...current,
        [fileName]: nextKeys,
      }
    })
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <h1>TXT CSV Diff Viewer</h1>
        <p>
          Compare two groups of delimited text files at once. Files are only compared when both groups contain the
          <strong> same filename</strong>. The first row is treated as the header row.
        </p>
      </header>

      <section className="panel controls-grid">
        <MultipleFilePicker label="Left file set" onLoaded={setLeftFiles} />
        <MultipleFilePicker label="Right file set" onLoaded={setRightFiles} />
      </section>

      {(leftFiles.length > 0 || rightFiles.length > 0) && (
        <>
          <details className="panel loaded-files-panel">
            <summary className="loaded-files-summary">
              <div>
                <strong>Loaded files</strong>
                <span className="loaded-files-subtitle">
                  Left: {leftFiles.length} · Right: {rightFiles.length}
                </span>
              </div>
            </summary>

            <div className="metadata-grid loaded-files-content">
              <div>
                <h2>Left file set</h2>
                <p><strong>Files loaded:</strong> {leftFiles.length}</p>
                {leftFiles.length > 0 ? (
                  <ul className="file-list">
                    {leftFiles.map((file) => (
                      <li key={`left-${file.fileName}`}>{file.fileName}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-state-text">No files loaded on the left side yet.</p>
                )}
              </div>

              <div>
                <h2>Right file set</h2>
                <p><strong>Files loaded:</strong> {rightFiles.length}</p>
                {rightFiles.length > 0 ? (
                  <ul className="file-list">
                    {rightFiles.map((file) => (
                      <li key={`right-${file.fileName}`}>{file.fileName}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-state-text">No files loaded on the right side yet.</p>
                )}
              </div>
            </div>
          </details>

          <section className="panel">
            <h2>Matched by identical filename</h2>
            <div className="summary-grid compact-gap">
              <div className="summary-card neutral-card">
                <span className="summary-label">Matched pairs</span>
                <strong>{matchedComparisons.length}</strong>
              </div>
              <div className="summary-card added-card">
                <span className="summary-label">Panels shown</span>
                <strong>{visibleComparisons.length}</strong>
              </div>
              <div className="summary-card modified-card">
                <span className="summary-label">Identical pairs hidden</span>
                <strong>{matchedComparisons.length - visibleComparisons.length}</strong>
              </div>
              <div className="summary-card deleted-card">
                <span className="summary-label">Unmatched files</span>
                <strong>{unmatchedLeftFiles.length + unmatchedRightFiles.length}</strong>
              </div>
            </div>

            <div className="notes unmatched-notes">
              <p><strong>Unmatched left:</strong> {unmatchedLeftFiles.length}</p>
              <p><strong>Unmatched right:</strong> {unmatchedRightFiles.length}</p>
              {(unmatchedLeftFiles.length > 0 || unmatchedRightFiles.length > 0) && (
                <>
                  {unmatchedLeftFiles.length > 0 && (
                    <p><strong>Only in left set:</strong> {unmatchedLeftFiles.join(', ')}</p>
                  )}
                  {unmatchedRightFiles.length > 0 && (
                    <p><strong>Only in right set:</strong> {unmatchedRightFiles.join(', ')}</p>
                  )}
                </>
              )}
            </div>
          </section>
        </>
      )}

      {visibleComparisons.length > 0 && (
        <section className="comparisons-stack">
          {visibleComparisons.map((comparison, index) => (
            <ComparisonPanel
              key={comparison.fileName}
              comparison={comparison}
              index={index}
              leftLabel="Left"
              rightLabel="Right"
              selectedKeys={comparison.selectedKeys}
              onToggleKey={toggleKey}
            />
          ))}
        </section>
      )}
    </main>
  )
}
