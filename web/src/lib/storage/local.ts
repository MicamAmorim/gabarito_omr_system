"use client";
import type { AppData, CorrectionResult, Exam, SchoolClass } from "@/lib/types/domain";
const KEY="gabarito-web:v1"; const EMPTY:AppData={exams:[],classes:[],results:[]};
function load():AppData{if(typeof window==="undefined")return EMPTY;try{const raw=localStorage.getItem(KEY);return raw?{...EMPTY,...JSON.parse(raw)}:EMPTY}catch{return EMPTY}}
function save(data:AppData){localStorage.setItem(KEY,JSON.stringify(data))}
function isAppData(value:unknown):value is AppData{if(!value||typeof value!=="object")return false;const d=value as Partial<AppData>;return Array.isArray(d.exams)&&Array.isArray(d.classes)&&Array.isArray(d.results)}
export function getData(){return load()}
export function listExams(){return load().exams}
export function getExam(id:string){return load().exams.find(x=>x.id===id)}
export function upsertExam(exam:Exam){const d=load();d.exams=[exam,...d.exams.filter(x=>x.id!==exam.id)];save(d)}
export function deleteExam(id:string){const d=load();d.exams=d.exams.filter(x=>x.id!==id);d.results=d.results.filter(x=>x.examId!==id);save(d)}
export function listClasses(){return load().classes}
export function getClass(id:string){return load().classes.find(x=>x.id===id)}
export function upsertClass(c:SchoolClass){const d=load();d.classes=[c,...d.classes.filter(x=>x.id!==c.id)];save(d)}
export function addResult(r:CorrectionResult){const d=load();d.results=[r,...d.results];save(d)}
export function addResultsBatch(results:CorrectionResult[]){if(!results.length)return;const d=load();d.results=[...results,...d.results];save(d)}
export function deleteResult(id:string){const d=load();d.results=d.results.filter(x=>x.id!==id);save(d)}
export function listResults(){return load().results}
export function clearLocalData(){save(EMPTY)}
export function exportLocalBackup(){return{format:"gabarito-web-backup",version:1,exportedAt:new Date().toISOString(),data:load()}}
export function importLocalBackup(raw:string):AppData{let parsed:unknown;try{parsed=JSON.parse(raw)}catch{throw new Error("O arquivo não é um JSON válido.")}const candidate=parsed&&typeof parsed==="object"&&"data" in parsed?(parsed as {data:unknown}).data:parsed;if(!isAppData(candidate))throw new Error("Este arquivo não parece ser um backup válido do Gabarito.");const clean:AppData={exams:candidate.exams,classes:candidate.classes,results:candidate.results};save(clean);return clean}
