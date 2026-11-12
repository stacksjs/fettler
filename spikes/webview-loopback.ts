const token = crypto.randomUUID()
let report: any
const done = Promise.withResolvers<void>()
const server = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  fetch(req, srv) {
    const url = new URL(req.url)
    if (url.pathname === '/ws') return srv.upgrade(req) ? undefined : new Response('no', { status: 400 })
    if (url.pathname === '/stream') {
      return new Response(new ReadableStream({ async start(c) { for (let i = 1; i <= 5; i++) { c.enqueue(new TextEncoder().encode(`chunk-${i}\n`)); await Bun.sleep(120) } c.close() } }), { headers: { 'content-type': 'text/plain' } })
    }
    if (url.pathname === '/report') return req.json().then((r) => { report = r; done.resolve(); return new Response('ok') })
    return new Response(`<!doctype html><meta charset=utf-8><title>Fettler spike</title><body style="font:14px system-ui;padding:24px"><h3>Fettler shell spike</h3><pre id=o></pre><script>
(async()=>{const out={ua:navigator.userAgent,craft:typeof window.craft,craftKeys:window.craft?Object.keys(window.craft).slice(0,40):[]};
const t0=performance.now();const r=await fetch('/stream');const rd=r.body.getReader();const dec=new TextDecoder();out.chunks=[];
for(;;){const{value,done}=await rd.read();if(done)break;out.chunks.push([Math.round(performance.now()-t0),dec.decode(value).trim()])}
out.ws=await new Promise(res=>{const w=new WebSocket('ws://'+location.host+'/ws');const got=[];w.onopen=()=>w.send('ping');w.onmessage=e=>{got.push(e.data);if(got.length===3){w.close();res(got)}};w.onerror=()=>res('error');setTimeout(()=>res(['timeout',...got]),4000)});
document.getElementById('o').textContent=JSON.stringify(out,null,1);await fetch('/report',{method:'POST',body:JSON.stringify(out)})})().catch(e=>fetch('/report',{method:'POST',body:JSON.stringify({error:String(e)})}))
</script>`, { headers: { 'content-type': 'text/html', 'set-cookie': `s=${token}; HttpOnly; SameSite=Strict` } })
  },
  websocket: { message(ws, m) { ws.send(`echo:${m}`); ws.send('push-1'); ws.send('push-2') } },
})
const craft = Bun.spawn(['/Users/chris/Code/Tools/craft/packages/zig/zig-out/bin/craft', '--url', `http://127.0.0.1:${server.port}/`, '--title', 'Fettler shell spike', '--width', '700', '--height', '420'], { stdout: 'ignore', stderr: 'pipe' })
const timeout = Bun.sleep(20000).then(() => 'timeout')
const outcome = await Promise.race([done.promise.then(() => 'reported'), timeout, craft.exited.then(c => `craft exited ${c}`)])
await Bun.sleep(300)
craft.kill()
console.log(outcome, JSON.stringify(report, null, 1))
if (outcome !== 'reported') console.log((await new Response(craft.stderr).text()).slice(0, 600))
server.stop(true); process.exit(0)
