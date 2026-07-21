export type Vec2=[number,number]; export type Vec3=[number,number,number]; export type Color=string|[number,number,number]|[number,number,number,number];
export interface Key<T>{frame:number;value:T;interpolation?:'linear'|'smooth'|'step'}
export interface PartSpec{front:string;back:string;side:string;pivot?:Vec3;[key:string]:unknown}
export interface BoneSpec{parent?:string;translation?:Vec3;rotation?:Vec3;part?:string;attachment?:{translation?:Vec3;rotation?:Vec3;[key:string]:unknown};[key:string]:unknown}
export interface ClipSpec{frames:number;fps:number;loop?:boolean;bones?:Record<string,{translation?:Key<Vec3>[];rotation?:Key<Vec3>[]}>;ik?:Record<string,{target?:Key<Vec3>[];pole?:Key<Vec3>[];weight?:Key<number>[]}>;[key:string]:unknown}
export interface ProjectDocument{palette:Record<string,Color>;parts:Record<string,PartSpec>;rig:{bones:Record<string,BoneSpec>;ik_chains?:Record<string,{root:string;mid:string;end:string}>;[key:string]:unknown};animations:Record<string,ClipSpec>;export?:{name?:string;size?:Vec2;scale?:number;origin?:Vec2;directions?:number[];animations?:string[];background?:Color;[key:string]:unknown};[key:string]:unknown}
