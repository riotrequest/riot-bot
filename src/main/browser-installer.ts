import childProcess from 'node:child_process'
import path from 'node:path'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'
import type { EventEmitter } from 'node:events'

// Playwright's downloader uses child_process.fork, which would relaunch Electron
// as a Node executable. Keep that one trusted helper in a worker instead, within
// the isolated utility process. No RunAsNode fuse or installed Node is needed.
if (!isMainThread) {
  const port=parentPort!
  process.send=((message:unknown)=>{port.postMessage(message);return true}) as typeof process.send
  port.on('message',message=>(process as EventEmitter).emit('message',message))
  port.once('close',()=>process.emit('disconnect'))
  require(workerData.entry)
} else {
  const cli=path.resolve(process.argv[2])
  const expected=path.join(path.dirname(cli),'lib','entry','oopBrowserDownload.js')
  childProcess.fork=((file:string)=>{
    if(path.resolve(file)!==expected)throw new Error('Refusing an unexpected browser-installer subprocess. Update Riot Bot’s Playwright integration.')
    const worker=new Worker(__filename,{workerData:{entry:expected}})
    return Object.assign(worker,{
      send:(message:unknown)=>{worker.postMessage(message);return true},
      kill:()=>{void worker.terminate();return true}
    })
  }) as unknown as typeof childProcess.fork
  process.argv=[process.execPath,cli,...process.argv.slice(3)]
  // Await the same CLI command explicitly: a utility process's parent channel can
  // otherwise keep it alive after installation has finished.
  const lib=path.join(path.dirname(cli),'lib')
  require(path.join(lib,'bootstrap'))
  const {libCli,libCliTestStub}=require(path.join(lib,'coreBundle'))
  const {program}=require(path.join(lib,'utilsBundle'))
  libCli.decorateProgram(program)
  libCliTestStub.decorateProgram(program)
  void program.parseAsync(process.argv).then(()=>process.exit(process.exitCode??0),(error:unknown)=>{console.error(error);process.exit(1)})
}
