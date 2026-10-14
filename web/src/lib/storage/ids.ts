export function newId(prefix:string){return `${prefix}_${crypto.randomUUID().replaceAll("-","").slice(0,16)}`}
