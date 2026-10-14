export type AnswerLetter = "A" | "B" | "C" | "D" | "E";
export type ExamMode = "general" | "student";
export interface Exam { id:string; name:string; subject:string; questions:number; alternatives:AnswerLetter[]; answerKey:AnswerLetter[]; maxScore:number; mode:ExamMode; classId?:string; createdAt:string; }
export interface Student { id:string; name:string; externalId?:string; }
export interface SchoolClass { id:string; name:string; students:Student[]; createdAt:string; }
export type MarkState = "marked" | "blank" | "double" | "review";
export interface QuestionRead { question:number; selected:AnswerLetter[]; scores:Record<AnswerLetter,number>; state:MarkState; confidence:number; }
export interface CorrectionResult { id:string; examId:string; studentId?:string; studentName?:string; createdAt:string; score:number; correct:number; wrong:number; blank:number; double:number; review:number; reads:QuestionRead[]; imageDataUrl?:string; batchId?:string; sourceName?:string; sourcePage?:number; batchSize?:number; }
export interface AppData { exams:Exam[]; classes:SchoolClass[]; results:CorrectionResult[]; }
