export interface Merged { a:string }
export interface Merged { b:string }
export namespace Merged { export const id=1 }
export function mergeUse(x:Merged){ return x.a+x.b+Merged.id }
