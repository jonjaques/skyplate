export function overloaded(x:string):string;
export function overloaded(x:number):number;
export function overloaded(x:any){return x}
export const over=overloaded(1);
