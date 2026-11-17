import './field';
declare module './field' { interface Field { augmented:number } }
export function augmentation(x:import('./field').Field){return x.augmented}
