import { chmodSync, closeSync, constants, fstatSync, lstatSync, openSync } from 'node:fs';
import { ingressSocket, prepareIngressSocket, removeOwnedIngressSocket } from './ingress.mjs';

const listen=(server,options)=>new Promise((resolve,reject)=>{
  const failed=error=>{server.off('listening',ready);reject(error);};
  const ready=()=>{server.off('error',failed);resolve();};
  server.once('error',failed);server.once('listening',ready);server.listen(options);
});
const close=server=>new Promise(resolve=>{
  if(!server?.listening)return resolve();
  server.close(resolve);server.closeIdleConnections();
});

// The serving process holds serve.lock for the entire lifetime of both listeners.
// Native state, nonce and maintenance live in their shared handler, not here.
export async function startNativeListeners({server,unixServer},state,port) {
  let ownedSocket=null,directoryFD=null;
  const socketPath=ingressSocket(state);
  let closing;
  const shutdown=()=>closing ||= (async()=>{
    // libuv unlinks a Unix bind path on close. Bind through a directory descriptor
    // and invalidate that alias first, so libuv cannot unlink a replaced path.
    // Only our captured inode is removed via the real state path below.
    if(directoryFD!==null){closeSync(directoryFD);directoryFD=null;}
    const draining=Promise.all([close(server),close(unixServer)]);
    try {if(ownedSocket)removeOwnedIngressSocket(socketPath,ownedSocket);}
    finally {await draining;}
  })();
  try {
    if(unixServer)await prepareIngressSocket(state);
    await listen(server,{port,host:'127.0.0.1'});
    if(unixServer) {
      directoryFD=openSync(state,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
      const directory=fstatSync(directoryFD),current=lstatSync(state);
      if(directory.dev!==current.dev||directory.ino!==current.ino)throw new Error('Private ingress state directory changed during startup.');
      await listen(unixServer,{path:`/proc/self/fd/${directoryFD}/inbox.sock`});
      ownedSocket=lstatSync(socketPath);
      if(!ownedSocket.isSocket()||ownedSocket.uid!==process.getuid())throw new Error('Private ingress socket ownership changed during startup.');
      chmodSync(socketPath,0o600);
    }
    return shutdown;
  } catch(error) {await shutdown();throw error;}
}
