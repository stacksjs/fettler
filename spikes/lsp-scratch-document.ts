const root = '/Users/chris/Code/Apps/fettler'
const proc = Bun.spawn([`${root}/node_modules/@typescript/typescript-darwin-arm64/lib/tsc`, '--lsp', '--stdio'], { cwd: root, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
let nextId = 1
const pending = new Map<number, (v: any) => void>()
const notes: any[] = []
const send = (msg: any) => { const body = JSON.stringify({ jsonrpc: '2.0', ...msg }); proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`); proc.stdin.flush() }
const request = (method: string, params: any) => new Promise<any>((res) => { const id = nextId++; pending.set(id, res); send({ id, method, params }) })
;(async () => {
  let buf = Buffer.alloc(0)
  for await (const chunk of proc.stdout as any) {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      const h = buf.indexOf('\r\n\r\n'); if (h < 0) break
      const len = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0, h).toString())![1])
      if (buf.length < h + 4 + len) break
      const msg = JSON.parse(buf.subarray(h + 4, h + 4 + len).toString()); buf = buf.subarray(h + 4 + len)
      if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)!(msg.result ?? { error: msg.error }); pending.delete(msg.id) }
      else if (msg.id !== undefined && msg.method) send({ id: msg.id, result: null })
      else notes.push(msg)
    }
  }
})()
const t0 = performance.now()
const init = await request('initialize', { processId: process.pid, rootUri: `file://${root}`, workspaceFolders: [{ uri: `file://${root}`, name: 'fettler' }], capabilities: { textDocument: { completion: { completionItem: { snippetSupport: false } }, hover: { contentFormat: ['plaintext'] }, publishDiagnostics: {} } } })
send({ method: 'initialized', params: {} })
const uri = `file://${root}/app/__fettler_scratch__.ts`
const text = `const user = await User.find(1)\nconst name = config.app.name\nconst bad: number = name\nuser.\nexport {}\n`
send({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'typescript', version: 1, text } } })
const hoverUser = await request('textDocument/hover', { textDocument: { uri }, position: { line: 0, character: 20 } })
const hoverName = await request('textDocument/hover', { textDocument: { uri }, position: { line: 1, character: 8 } })
const completion = await request('textDocument/completion', { textDocument: { uri }, position: { line: 3, character: 5 } })
const items = (completion?.items ?? completion ?? [])
const diag = await request('textDocument/diagnostic', { textDocument: { uri } }).catch(() => null)
await Bun.sleep(1500)
const pushed = notes.filter(n => n.method === 'textDocument/publishDiagnostics' && n.params.uri === uri).pop()
const txt = (h: any) => JSON.stringify(h?.contents?.value ?? h?.contents ?? h).slice(0, 220)
console.log(JSON.stringify({
  ms: Math.round(performance.now() - t0),
  server: init?.serverInfo, completionProvider: !!init?.capabilities?.completionProvider,
  hoverUser: txt(hoverUser), hoverName: txt(hoverName),
  completions: Array.isArray(items) ? items.length : 'n/a', sample: Array.isArray(items) ? items.slice(0, 12).map((i: any) => i.label) : items,
  pullDiagnostics: (diag?.items ?? []).map((d: any) => `${d.range.start.line}: ${d.message}`).slice(0, 5),
  pushedDiagnostics: (pushed?.params?.diagnostics ?? []).map((d: any) => `${d.range.start.line}: ${d.message}`).slice(0, 5),
}, null, 1))
proc.kill(); process.exit(0)
