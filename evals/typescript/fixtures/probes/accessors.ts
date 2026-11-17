export class Access { private v=0; get value(){return this.v} set value(v:number){this.v=v} constructor(){} }
export function useAccess(){ const a=new Access(); a.value=1; return a.value; }
