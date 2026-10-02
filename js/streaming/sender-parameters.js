const queues=new WeakMap();
export function mutateVideoSender(sender,mutate) {
 const previous=queues.get(sender)||Promise.resolve();
 const operation=previous.catch(()=>{}).then(async()=>{
  const params=sender.getParameters?.();if(!params?.encodings?.length)return false;
  mutate(params);
  try{await sender.setParameters(params);return true;}
  catch(error){
   if(!['NotSupportedError','InvalidModificationError'].includes(error.name))throw error;
   // Optional priority knobs must not prevent bitrate and FPS limits from being applied.
   const retry=sender.getParameters();if(!retry.encodings?.length)return false;mutate(retry);
   delete retry.degradationPreference;for(const e of retry.encodings){delete e.priority;delete e.networkPriority;}
   await sender.setParameters(retry);return true;
  }
 });
 queues.set(sender,operation);return operation;
}

