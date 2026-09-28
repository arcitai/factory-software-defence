// Work-type suggestions guide the operator; they never admit work or change access.
export function recommendWork({spec,labels=[]}) {
  if(typeof spec!=='string'||!spec.trim()||Buffer.byteLength(spec)>240000)throw new Error('Provide an issue description between 1 byte and 240 KB.');
  if(!Array.isArray(labels)||labels.length>100||labels.some(label=>typeof label!=='string'||label.length>100))throw new Error('Expected issue label names.');
  const names=labels.map(label=>label.toLowerCase()),software=names.includes('track:software');
  const defensive=names.some(label=>['track:security','track:defence','track:defense'].includes(label));
  let work_type='software',basis='default',reason='Software delivery is the default for changes to this project.';
  if(defensive&&!software){work_type='defensive';basis='label';reason='Issue labels suggest a scoped defensive investigation.';}
  else if(defensive&&software){basis='conflicting_labels';reason='Both work types are labelled. Choose the intended scope when starting work.';}
  else if(software){basis='label';reason='The issue is labelled for software delivery.';}
  else if(/\b(?:investigat(?:e|ion|ing)|triage|analys[ei][rs]?|analy[sz]e|undersøg(?:e|else|er))\b[\s\S]{0,100}\b(?:incident|intrusion|breach|malware|compromise|suspicious|security logs|hændelse|angreb)\b/i.test(spec)){
    work_type='defensive';basis='description';reason='The description suggests analysis of a supplied security incident or evidence.';
  }
  return {workflow:work_type,work_type,basis,reason};
}
