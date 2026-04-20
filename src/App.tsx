import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const EMPLOYEE_COUNT = 3;
const ROLE_OPTIONS = [
  { value: "", label: "자동" },
  { value: "A", label: "A" },
  { value: "B", label: "B" },
  { value: "OFF", label: "휴무" },
] as const;
const DAILY_ROLE_SETS = [
  ["A", "B", "OFF"],
  ["A", "OFF", "B"],
  ["B", "A", "OFF"],
  ["B", "OFF", "A"],
  ["OFF", "A", "B"],
  ["OFF", "B", "A"],
] as const;

const initialEmployees = [
  { id: 0, name: "직원 1" },
  { id: 1, name: "직원 2" },
  { id: 2, name: "직원 3" },
];

type Role = "A" | "B" | "OFF";
type FixedRole = "" | Role;
type Employee = { id: number; name: string };
type FixedAssignments = Record<string, FixedRole>;
type Matrix = Record<string, Role>;

type StatsState = {
  workCounts: number[];
  offCounts: number[];
  weekdayOffCounts: number[];
  weekendOffCounts: number[];
  aCounts: number[];
  weekdayBCounts: number[];
  weekendBCounts: number[];
  consecutiveWork: number[];
};

type DayAssignment = {
  dateKey: string;
  aId: number;
  bId: number;
  offId: number;
};

type EmployeeStats = {
  id: number;
  name: string;
  totalWork: number;
  totalOff: number;
  totalA: number;
  weekdayB: number;
  weekendB: number;
  totalB: number;
};

type ScheduleResult = {
  schedule: DayAssignment[];
  matrix: Matrix;
  warnings: string[];
  stats: EmployeeStats[] | null;
  meta: {
    validCaseCount: number;
    score?: number;
    signature?: string;
    variantCount?: number;
    selectedVariantIndex?: number;
  };
};

type Candidate = {
  schedule: DayAssignment[];
  matrix: Matrix;
  statsState: StatsState;
  score: number;
  signature: string;
};

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function toISODate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(input: string) {
  const [y, m, d] = input.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function getMonday(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  return new Date(next.getFullYear(), next.getMonth(), next.getDate());
}

function getDates(startDate: string, days = 7) {
  const start = getMonday(parseDate(startDate));
  return Array.from({ length: days }, (_, i) => {
    const current = new Date(start);
    current.setDate(start.getDate() + i);
    return current;
  });
}

function formatWeekdayLabel(date: Date) {
  return WEEKDAYS[date.getDay()];
}

function formatDateLabel(date: Date) {
  return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAYS[date.getDay()]})`;
}

function isWeekendBucket(date: Date) {
  return [5, 6, 0].includes(date.getDay());
}

function getCellKey(employeeId: number, dayIndex: number) {
  return `${employeeId}-${dayIndex}`;
}

function getRoleBadgeClass(role: string) {
  if (role === "A") return "border-sky-200 bg-sky-50 text-sky-700";
  if (role === "B") return "border-violet-200 bg-violet-50 text-violet-700";
  if (role === "OFF") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-white text-slate-500";
}

function getRoleText(role: FixedRole) {
  if (role === "OFF") return "휴무";
  return role || "";
}

function createZeroArray() {
  return Array(EMPLOYEE_COUNT).fill(0);
}

function createInitialState(): StatsState {
  return {
    workCounts: createZeroArray(),
    offCounts: createZeroArray(),
    weekdayOffCounts: createZeroArray(),
    weekendOffCounts: createZeroArray(),
    aCounts: createZeroArray(),
    weekdayBCounts: createZeroArray(),
    weekendBCounts: createZeroArray(),
    consecutiveWork: createZeroArray(),
  };
}

function cloneState(state: StatsState): StatsState {
  return {
    workCounts: [...state.workCounts],
    offCounts: [...state.offCounts],
    weekdayOffCounts: [...state.weekdayOffCounts],
    weekendOffCounts: [...state.weekendOffCounts],
    aCounts: [...state.aCounts],
    weekdayBCounts: [...state.weekdayBCounts],
    weekendBCounts: [...state.weekendBCounts],
    consecutiveWork: [...state.consecutiveWork],
  };
}

function scoreSchedule(state: StatsState, assignments: DayAssignment[]) {
  const totalBCounts = state.weekdayBCounts.map((count, index) => count + state.weekendBCounts[index]);
  const workGap = Math.max(...state.workCounts) - Math.min(...state.workCounts);
  const totalBGap = Math.max(...totalBCounts) - Math.min(...totalBCounts);

  let repeatedPenalty = 0;
  for (let i = 1; i < assignments.length; i += 1) {
    if (assignments[i - 1].bId === assignments[i].bId) repeatedPenalty += 3;
    if (assignments[i - 1].offId === assignments[i].offId) repeatedPenalty += 2;
  }

  return workGap * 100 + totalBGap * 40 + repeatedPenalty;
}

function isFinalStateValid(state: StatsState) {
  const everyoneHasWeekendOff = state.weekendOffCounts.every((count) => count === 1);
  const everyoneHasWeekendB = state.weekendBCounts.every((count) => count === 1);
  const everyoneHasWeekdayB = state.weekdayBCounts.every((count) => count >= 1);
  const maxConsecutiveValid = state.consecutiveWork.every((count) => count <= 3);

  return everyoneHasWeekendOff && everyoneHasWeekendB && everyoneHasWeekdayB && maxConsecutiveValid;
}

function validateFixedAssignments(dates: Date[], fixedAssignments: FixedAssignments, employees: Employee[]) {
  const warnings: string[] = [];

  dates.forEach((date, dayIndex) => {
    const counts = { A: 0, B: 0, OFF: 0 };
    employees.forEach((employee) => {
      const value = fixedAssignments[getCellKey(employee.id, dayIndex)] || "";
      if (value === "A" || value === "B" || value === "OFF") counts[value] += 1;
    });

    if (counts.A > 1) warnings.push(`${formatDateLabel(date)}에 A가 2명으로 고정되어 있다.`);
    if (counts.B > 1) warnings.push(`${formatDateLabel(date)}에 B가 2명으로 고정되어 있다.`);
    if (counts.OFF > 1) warnings.push(`${formatDateLabel(date)}에 휴무가 2명으로 고정되어 있다.`);
  });

  return warnings;
}

function buildMatrix(schedule: DayAssignment[]) {
  const matrix: Matrix = {};
  schedule.forEach((row, dayIndex) => {
    matrix[getCellKey(row.aId, dayIndex)] = "A";
    matrix[getCellKey(row.bId, dayIndex)] = "B";
    matrix[getCellKey(row.offId, dayIndex)] = "OFF";
  });
  return matrix;
}

function buildSignature(matrix: Matrix, employees: Employee[], dayCount: number) {
  const rows = employees.map((employee) => {
    const values = Array.from({ length: dayCount }, (_, dayIndex) => matrix[getCellKey(employee.id, dayIndex)] || "-");
    return `${employee.id}:${values.join("")}`;
  });
  return rows.join("|");
}

function buildEmployeeStats(employees: Employee[], statsState: StatsState): EmployeeStats[] {
  return employees.map((employee) => ({
    id: employee.id,
    name: employee.name,
    totalWork: statsState.workCounts[employee.id],
    totalOff: statsState.offCounts[employee.id],
    totalA: statsState.aCounts[employee.id],
    weekdayB: statsState.weekdayBCounts[employee.id],
    weekendB: statsState.weekendBCounts[employee.id],
    totalB: statsState.weekdayBCounts[employee.id] + statsState.weekendBCounts[employee.id],
  }));
}

function pickCandidate(candidates: Candidate[], previousSignature?: string) {
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => a.score - b.score || a.signature.localeCompare(b.signature));
  const uniqueCandidates = sorted.filter((candidate, index) => index === 0 || candidate.signature !== sorted[index - 1].signature);
  const selectable = previousSignature
    ? uniqueCandidates.filter((candidate) => candidate.signature !== previousSignature)
    : uniqueCandidates;
  const pool = selectable.length > 0 ? selectable : uniqueCandidates;
  const selectedIndex = Math.floor(Math.random() * pool.length);

  return {
    candidate: pool[selectedIndex],
    variantCount: uniqueCandidates.length,
    selectedVariantIndex: uniqueCandidates.findIndex((item) => item.signature === pool[selectedIndex].signature),
  };
}

function generateWeeklySchedule({
  employees,
  startDate,
  fixedAssignments,
  previousSignature,
}: {
  employees: Employee[];
  startDate: string;
  fixedAssignments: FixedAssignments;
  previousSignature?: string;
}): ScheduleResult {
  const dates = getDates(startDate, 7);
  const warnings = [...validateFixedAssignments(dates, fixedAssignments, employees)];

  if (warnings.length > 0) {
    return {
      schedule: [],
      matrix: {},
      warnings,
      stats: null,
      meta: { validCaseCount: 0, variantCount: 0 },
    };
  }

  const candidates: Candidate[] = [];
  let validCaseCount = 0;

  function search(dayIndex: number, assignments: DayAssignment[], state: StatsState) {
    if (dayIndex === dates.length) {
      if (!isFinalStateValid(state)) return;

      validCaseCount += 1;
      const finalSchedule = assignments.map((item) => ({ ...item }));
      const finalState = cloneState(state);
      const matrix = buildMatrix(finalSchedule);
      const signature = buildSignature(matrix, employees, dates.length);

      candidates.push({
        schedule: finalSchedule,
        matrix,
        statsState: finalState,
        score: scoreSchedule(finalState, finalSchedule),
        signature,
      });
      return;
    }

    const date = dates[dayIndex];
    const weekend = isWeekendBucket(date);

    for (const roleSet of DAILY_ROLE_SETS) {
      let matchesFixed = true;
      for (let employeeIndex = 0; employeeIndex < employees.length; employeeIndex += 1) {
        const fixedRole = fixedAssignments[getCellKey(employees[employeeIndex].id, dayIndex)] || "";
        if (fixedRole && fixedRole !== roleSet[employeeIndex]) {
          matchesFixed = false;
          break;
        }
      }
      if (!matchesFixed) continue;

      const nextState = cloneState(state);
      let invalid = false;
      let aId = -1;
      let bId = -1;
      let offId = -1;

      for (let employeeIndex = 0; employeeIndex < employees.length; employeeIndex += 1) {
        const employeeId = employees[employeeIndex].id;
        const role = roleSet[employeeIndex];

        if (role === "OFF") {
          offId = employeeId;
          nextState.offCounts[employeeId] += 1;
          nextState.consecutiveWork[employeeId] = 0;

          if (weekend) {
            nextState.weekendOffCounts[employeeId] += 1;
            if (nextState.weekendOffCounts[employeeId] > 1) invalid = true;
          } else {
            nextState.weekdayOffCounts[employeeId] += 1;
          }
        } else {
          nextState.workCounts[employeeId] += 1;
          nextState.consecutiveWork[employeeId] += 1;
          if (nextState.consecutiveWork[employeeId] > 3) invalid = true;

          if (role === "A") {
            aId = employeeId;
            nextState.aCounts[employeeId] += 1;
          }

          if (role === "B") {
            bId = employeeId;
            if (weekend) {
              nextState.weekendBCounts[employeeId] += 1;
              if (nextState.weekendBCounts[employeeId] > 1) invalid = true;
            } else {
              nextState.weekdayBCounts[employeeId] += 1;
              if (nextState.weekdayBCounts[employeeId] > 2) invalid = true;
            }
          }
        }
      }

      if (invalid || aId === -1 || bId === -1 || offId === -1) continue;

      const remainingDays = dates.slice(dayIndex + 1);
      const remainingWeekendDays = remainingDays.filter((item) => isWeekendBucket(item)).length;
      const remainingWeekdayDays = remainingDays.length - remainingWeekendDays;

      const impossible = employees.some((employee) => {
        const id = employee.id;

        if (nextState.weekendOffCounts[id] > 1) return true;
        if (nextState.weekendBCounts[id] > 1) return true;
        if (nextState.weekdayBCounts[id] > 2) return true;

        if (nextState.weekendOffCounts[id] + remainingWeekendDays < 1) return true;
        if (nextState.weekendBCounts[id] + remainingWeekendDays < 1) return true;
        if (nextState.weekdayBCounts[id] + remainingWeekdayDays < 1) return true;

        return false;
      });

      if (impossible) continue;

      search(
        dayIndex + 1,
        [...assignments, { dateKey: toISODate(date), aId, bId, offId }],
        nextState
      );
    }
  }

  search(0, [], createInitialState());

  const selected = pickCandidate(candidates, previousSignature);

  if (!selected) {
    warnings.push("현재 고정값과 조건을 동시에 만족하는 스케줄을 찾지 못했다.");
    return {
      schedule: [],
      matrix: {},
      warnings,
      stats: null,
      meta: { validCaseCount, variantCount: 0 },
    };
  }

  const employeeStats = buildEmployeeStats(employees, selected.candidate.statsState);

  warnings.push(
    `월~목 B는 총 4회라서 3명 중 1명은 2회 배정된다. 현재 결과: ${employeeStats
      .map((item) => `${item.name} ${item.weekdayB}회`)
      .join(" / ")}`
  );
  warnings.push(
    `금~일 B는 총 3회라서 3명 모두 1회씩 배정된다. 현재 결과: ${employeeStats
      .map((item) => `${item.name} ${item.weekendB}회`)
      .join(" / ")}`
  );
  if ((selected.variantCount || 0) <= 1) {
    warnings.push("현재 고정값 기준으로 가능한 결과가 1개뿐이라, 다시 눌러도 같은 배정이 나올 수 있다.");
  }

  return {
    schedule: selected.candidate.schedule,
    matrix: selected.candidate.matrix,
    warnings,
    stats: employeeStats,
    meta: {
      validCaseCount,
      score: selected.candidate.score,
      signature: selected.candidate.signature,
      variantCount: selected.variantCount,
      selectedVariantIndex: selected.selectedVariantIndex,
    },
  };
}

function runSelfTests() {
  const monday = "2026-04-20";
  const mondayDate = parseDate(monday);
  console.assert(formatWeekdayLabel(mondayDate) === "월", "요일 라벨은 월이어야 한다.");
  console.assert(toISODate(getMonday(parseDate("2026-04-26"))) === monday, "일요일 입력도 같은 주 월요일로 보정되어야 한다.");

  const valid = generateWeeklySchedule({
    employees: initialEmployees,
    startDate: monday,
    fixedAssignments: {},
  });
  console.assert(valid.schedule.length === 7, "기본 생성은 7일 스케줄을 반환해야 한다.");
  console.assert((valid.stats || []).every((item) => item.weekendB === 1), "모든 인원은 금~일 B를 1회씩 가져야 한다.");
  console.assert((valid.stats || []).every((item) => item.totalOff >= 2), "모든 인원은 최소 2회 이상 휴무가 있어야 한다.");

  const invalid = generateWeeklySchedule({
    employees: initialEmployees,
    startDate: monday,
    fixedAssignments: {
      [getCellKey(0, 0)]: "A",
      [getCellKey(1, 0)]: "A",
    },
  });
  console.assert(invalid.schedule.length === 0, "같은 날 A 중복 고정이면 스케줄 생성이 실패해야 한다.");
  console.assert(invalid.warnings.length > 0, "충돌 고정값이 있으면 경고가 있어야 한다.");

  const preserved = generateWeeklySchedule({
    employees: initialEmployees,
    startDate: monday,
    fixedAssignments: {
      [getCellKey(0, 0)]: "OFF",
    },
  });
  console.assert(preserved.matrix[getCellKey(0, 0)] === "OFF", "고정한 휴무는 결과에도 유지되어야 한다.");

  const rerolled = generateWeeklySchedule({
    employees: initialEmployees,
    startDate: monday,
    fixedAssignments: {},
    previousSignature: valid.meta.signature,
  });
  console.assert(rerolled.meta.variantCount && rerolled.meta.variantCount >= 1, "가능한 변형 개수는 1 이상이어야 한다.");
}

function ScheduleCell({
  value,
  finalValue,
  onChange,
}: {
  value: FixedRole;
  finalValue: FixedRole;
  onChange: (value: FixedRole) => void;
}) {
  const displayRole = finalValue || value || "";

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as FixedRole)}
      className={classNames(
        "w-full rounded-xl border px-3 py-3 text-center text-sm font-medium outline-none transition focus:border-slate-400",
        getRoleBadgeClass(displayRole)
      )}
    >
      {ROLE_OPTIONS.map((option) => (
        <option key={option.value || "auto"} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function ResultCell({ role }: { role: FixedRole }) {
  return (
    <div
      className={classNames(
        "rounded-xl border px-3 py-3 text-center text-sm font-semibold",
        role ? getRoleBadgeClass(role) : "border-slate-200 bg-slate-50 text-slate-400"
      )}
    >
      {getRoleText(role) || "-"}
    </div>
  );
}

function ResultTable({
  title,
  employees,
  dates,
  matrix,
}: {
  title: string;
  employees: Employee[];
  dates: Date[];
  matrix: Matrix;
}) {
  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm md:p-8">
      <div className="mb-4 text-lg font-semibold text-slate-900">{title}</div>
      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 overflow-hidden rounded-2xl border border-slate-200 text-sm">
          <thead>
            <tr className="bg-slate-100 text-slate-700">
              <th className="sticky left-0 z-10 min-w-[160px] border-b border-r border-slate-200 bg-slate-100 px-4 py-3 text-left font-semibold">
                이름
              </th>
              {dates.map((date) => (
                <th key={`${title}-${toISODate(date)}`} className="min-w-[100px] border-b border-slate-200 px-3 py-3 text-center font-semibold">
                  {formatWeekdayLabel(date)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={`${title}-${employee.id}`}>
                <td className="sticky left-0 z-10 border-r border-b border-slate-200 bg-white px-4 py-3 font-medium text-slate-900">
                  {employee.name}
                </td>
                {dates.map((date, dayIndex) => {
                  const role = matrix[getCellKey(employee.id, dayIndex)] || "";
                  return (
                    <td key={`${title}-${employee.id}-${toISODate(date)}`} className="border-b border-slate-200 px-3 py-3">
                      <ResultCell role={role} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function ShiftSchedulerMVP() {
  const initialMonday = useMemo(() => toISODate(getMonday(new Date())), []);
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [startDate] = useState(initialMonday);
  const [fixedAssignments, setFixedAssignments] = useState<FixedAssignments>({});
  const [generated, setGenerated] = useState<ScheduleResult>(() =>
    generateWeeklySchedule({
      employees: initialEmployees,
      startDate: initialMonday,
      fixedAssignments: {},
    })
  );
  const [previousGenerated, setPreviousGenerated] = useState<ScheduleResult | null>(null);

  const dates = useMemo(() => getDates(startDate, 7), [startDate]);

  useEffect(() => {
    runSelfTests();
  }, []);

  const updateEmployeeName = (id: number, name: string) => {
    setEmployees((prev) => prev.map((employee) => (employee.id === id ? { ...employee, name } : employee)));
  };

  const updateFixedAssignment = (employeeId: number, dayIndex: number, value: FixedRole) => {
    const key = getCellKey(employeeId, dayIndex);
    setFixedAssignments((prev) => {
      const next = { ...prev };
      if (!value) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  const handleGenerate = () => {
    const normalizedEmployees = employees.map((employee) => ({
      ...employee,
      name: employee.name.trim() || `근무자 ${employee.id + 1}`,
    }));

    setEmployees(normalizedEmployees);
    setPreviousGenerated(generated.schedule.length > 0 ? generated : null);

    const nextGenerated = generateWeeklySchedule({
      employees: normalizedEmployees,
      startDate,
      fixedAssignments,
      previousSignature: generated.meta.signature,
    });

    setGenerated(nextGenerated);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl p-6 md:p-8">
        <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="text-xl font-semibold text-slate-900">주간 근무표</div>
            <button
              type="button"
              onClick={handleGenerate}
              className="rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              자동 배정
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 overflow-hidden rounded-2xl border border-slate-200 text-sm">
              <thead>
                <tr className="bg-slate-100 text-slate-700">
                  <th className="sticky left-0 z-10 min-w-[160px] border-b border-r border-slate-200 bg-slate-100 px-4 py-3 text-left font-semibold">
                    이름
                  </th>
                  {dates.map((date) => (
                    <th key={toISODate(date)} className="min-w-[120px] border-b border-slate-200 px-3 py-3 text-center font-semibold">
                      {formatWeekdayLabel(date)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr key={employee.id}>
                    <td className="sticky left-0 z-10 border-r border-b border-slate-200 bg-white px-4 py-3">
                      <input
                        value={employee.name}
                        onChange={(e) => updateEmployeeName(employee.id, e.target.value)}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 font-medium outline-none transition focus:border-slate-400"
                        placeholder={`근무자 ${employee.id + 1}`}
                      />
                    </td>
                    {dates.map((date, dayIndex) => {
                      const key = getCellKey(employee.id, dayIndex);
                      const fixedValue = fixedAssignments[key] || "";
                      const finalValue = generated.matrix[key] || "";

                      return (
                        <td key={`${employee.id}-${toISODate(date)}`} className="border-b border-slate-200 px-3 py-3">
                          <ScheduleCell
                            value={fixedValue}
                            finalValue={finalValue}
                            onChange={(value) => updateFixedAssignment(employee.id, dayIndex, value)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="mt-6 space-y-6">
          <ResultTable title="현재 배정 결과" employees={employees} dates={dates} matrix={generated.matrix} />

          {previousGenerated?.schedule.length ? (
            <ResultTable title="직전 배정 결과" employees={employees} dates={dates} matrix={previousGenerated.matrix} />
          ) : null}
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-base font-semibold text-slate-900">배정 상태</div>
            {generated.schedule.length > 0 ? (
              <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                <div className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="h-4 w-4" />
                  배정 가능
                </div>
                <div className="mt-2">유효 조합 수: {generated.meta.validCaseCount}</div>
                <div className="mt-1">가능한 결과 수: {generated.meta.variantCount ?? 0}</div>
              </div>
            ) : (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                현재 조건으로는 결과가 없다.
              </div>
            )}
          </section>

          <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm md:col-span-2">
            <div className="text-base font-semibold text-slate-900">배정 통계</div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {generated.stats?.map((person) => (
                <div key={person.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                  <div className="font-medium text-slate-900">{person.name}</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-slate-600">
                    <div>총 근무 {person.totalWork}일</div>
                    <div>총 휴무 {person.totalOff}일</div>
                    <div>A {person.totalA}회</div>
                    <div>B {person.totalB}회</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {generated.warnings.length > 0 && (
          <section className="mt-4 rounded-[24px] border border-amber-200 bg-amber-50 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-base font-semibold text-amber-900">
              <AlertTriangle className="h-4 w-4" />
              검토 사항
            </div>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-800">
              {generated.warnings.map((warning, index) => (
                <li key={`${warning}-${index}`}>{warning}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
