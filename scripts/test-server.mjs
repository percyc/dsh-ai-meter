import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const bundle=await build({entryPoints:['tests/browser/harness.tsx'],bundle:true,format:'iife',platform:'browser',write:false,define:{'process.env.NODE_ENV':'"development"'}});
const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AI Meter test fixture</title><body style="margin:0;background:#fcfcfa;color:#202724"><div id="root"></div><script src="/harness.js"></script></body></html>';
createServer(async(req,res)=>{
  const route=req.url?.split('?')[0];
  if(route==='/client.js'){res.setHeader('Content-Type','application/javascript');res.end(await readFile('dist/client.js'));}
  else if(route==='/harness.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].text);}
  else if(route==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}
  else {res.statusCode=404;res.end();}
}).listen(4178,'127.0.0.1');
