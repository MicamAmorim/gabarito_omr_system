"use client";

import type { AnswerLetter, Exam, SchoolClass, Student } from "@/lib/types/domain";
import { listClasses, listExams, upsertClass, upsertExam } from "@/lib/storage/local";
import { newId } from "@/lib/storage/ids";

type ImportedStudent = { externalId?: string; name: string };
type ImportedClass = { externalId?: string; eclassId?: number; name: string; students?: ImportedStudent[] };
type ImportedQuestion = { number: number; type: "objective" | "open"; answer?: string; response?: { format?: string; lines?: number } };
type EClassOmrPackage = {
  schema: "eclass-omr-exam/1";
  version?: number;
  source?: string;
  exportedAt?: string;
  externalId?: string;
  exam: {
    title: string;
    subject?: string;
    mode?: "general" | "student";
    questions?: ImportedQuestion[];
    omr: {
      alternatives?: string[];
      objectiveQuestionNumbers?: number[];
      answerKey: string[];
    };
    classes?: ImportedClass[];
  };
};

export interface EClassImportResult {
  exam: Exam;
  duplicate: boolean;
  classesAdded: number;
  classesMerged: number;
  studentsAdded: number;
  openQuestionsIgnored: number;
}

const LETTERS = new Set<AnswerLetter>(["A", "B", "C", "D", "E"]);
const norm = (s: string) => s.trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");

function parsePackage(raw: string): EClassOmrPackage {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error("O arquivo não é um JSON válido."); }
  if (!value || typeof value !== "object") throw new Error("Arquivo de importação inválido.");
  const p = value as Partial<EClassOmrPackage>;
  if (p.schema !== "eclass-omr-exam/1" || !p.exam || typeof p.exam !== "object") {
    throw new Error("Este arquivo não é uma exportação do E-Class Prova Injector.");
  }
  const exam = p.exam as EClassOmrPackage["exam"];
  if (!exam.title?.trim() || !exam.omr || !Array.isArray(exam.omr.answerKey)) {
    throw new Error("A exportação não contém título e gabarito OMR válidos.");
  }
  const answerKey = exam.omr.answerKey.map(x => String(x).toUpperCase() as AnswerLetter);
  if (!answerKey.length || answerKey.some(x => !LETTERS.has(x))) {
    throw new Error("O gabarito contém alternativas inválidas; use somente A, B, C, D ou E.");
  }
  return p as EClassOmrPackage;
}

function mergeStudents(existing: Student[], incoming: ImportedStudent[]) {
  const out = [...existing];
  let added = 0;
  for (const s of incoming) {
    const name = String(s.name || "").trim();
    if (!name) continue;
    const ext = s.externalId?.trim();
    const found = out.find(x => (ext && x.externalId === ext) || (!ext && norm(x.name) === norm(name)));
    if (found) continue;
    out.push({ id: newId("student"), name, externalId: ext });
    added++;
  }
  return { students: out, added };
}

function addOrMergeClasses(incoming: ImportedClass[]) {
  const existing = listClasses();
  const linkedIds: string[] = [];
  let classesAdded = 0, classesMerged = 0, studentsAdded = 0;

  for (const c of incoming) {
    const name = String(c.name || "").trim();
    if (!name) continue;
    const ext = c.externalId?.trim();
    let current = existing.find(x => (ext && x.externalId === ext) || norm(x.name) === norm(name));
    if (current) {
      const merged = mergeStudents(current.students || [], c.students || []);
      const next: SchoolClass = { ...current, externalId: current.externalId || ext, students: merged.students };
      upsertClass(next);
      current = next;
      classesMerged++;
      studentsAdded += merged.added;
    } else {
      const merged = mergeStudents([], c.students || []);
      current = { id: newId("class"), name, externalId: ext, students: merged.students, createdAt: new Date().toISOString() };
      upsertClass(current);
      existing.unshift(current);
      classesAdded++;
      studentsAdded += merged.added;
    }
    linkedIds.push(current.id);
  }
  return { linkedIds, classesAdded, classesMerged, studentsAdded };
}

export function importEclassExam(raw: string): EClassImportResult {
  const pkg = parsePackage(raw);
  const duplicate = pkg.externalId ? listExams().find(x => x.externalId === pkg.externalId) : undefined;
  if (duplicate) {
    return { exam: duplicate, duplicate: true, classesAdded: 0, classesMerged: 0, studentsAdded: 0, openQuestionsIgnored: (pkg.exam.questions || []).filter(q => q.type === "open").length };
  }

  const answerKey = pkg.exam.omr.answerKey.map(x => String(x).toUpperCase() as AnswerLetter);
  const sourceNumbers = Array.isArray(pkg.exam.omr.objectiveQuestionNumbers) && pkg.exam.omr.objectiveQuestionNumbers.length === answerKey.length
    ? pkg.exam.omr.objectiveQuestionNumbers.map(Number)
    : answerKey.map((_, i) => i + 1);
  const incomingClasses = (pkg.exam.classes || []).filter(c => Array.isArray(c.students) && c.students.length > 0);
  const classResult = incomingClasses.length ? addOrMergeClasses(incomingClasses) : { linkedIds: [] as string[], classesAdded: 0, classesMerged: 0, studentsAdded: 0 };
  const useStudentMode = classResult.linkedIds.length > 0;

  const exam: Exam = {
    id: newId("exam"),
    name: pkg.exam.title.trim(),
    subject: pkg.exam.subject?.trim() || "Geral",
    questions: answerKey.length,
    alternatives: ["A", "B", "C", "D", "E"],
    answerKey,
    maxScore: 10,
    mode: useStudentMode ? "student" : "general",
    classId: useStudentMode ? classResult.linkedIds[0] : undefined,
    classIds: useStudentMode ? classResult.linkedIds : undefined,
    createdAt: new Date().toISOString(),
    externalId: pkg.externalId,
    source: pkg.source || "E-Class Prova Injector",
    sourceQuestionNumbers: sourceNumbers
  };
  upsertExam(exam);

  return {
    exam,
    duplicate: false,
    classesAdded: classResult.classesAdded,
    classesMerged: classResult.classesMerged,
    studentsAdded: classResult.studentsAdded,
    openQuestionsIgnored: (pkg.exam.questions || []).filter(q => q.type === "open").length
  };
}
