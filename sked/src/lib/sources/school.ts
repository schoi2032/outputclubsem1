export type Block = { start: string; end: string; what: string; where: string; kind: "class" | "club" };
export type Test = { name: string; day: string; when: string };

const week: Record<number, Block[]> = {
  1: [
    { start: "08:00", end: "08:50", what: "English 10", where: "Room 108", kind: "class" },
    { start: "08:55", end: "09:45", what: "Geometry", where: "Room 301", kind: "class" },
    { start: "09:50", end: "10:35", what: "AP World History", where: "Room 214", kind: "class" },
    { start: "10:45", end: "11:35", what: "Chemistry", where: "B wing lab", kind: "class" },
    { start: "12:20", end: "13:10", what: "Spanish 2", where: "Room 119", kind: "class" },
    { start: "13:15", end: "14:05", what: "PE", where: "Gym", kind: "class" },
  ],
  2: [
    { start: "08:00", end: "08:50", what: "Chemistry", where: "B wing lab", kind: "class" },
    { start: "08:55", end: "09:45", what: "Spanish 2", where: "Room 119", kind: "class" },
    { start: "09:50", end: "10:35", what: "English 10", where: "Room 108", kind: "class" },
    { start: "10:45", end: "11:35", what: "Computer Science", where: "Room 220", kind: "class" },
    { start: "12:20", end: "13:10", what: "Geometry", where: "Room 301", kind: "class" },
    { start: "15:15", end: "16:30", what: "Output Club meeting", where: "Library", kind: "club" },
  ],
  3: [
    { start: "08:00", end: "08:50", what: "AP World History", where: "Room 214", kind: "class" },
    { start: "08:55", end: "09:45", what: "Computer Science", where: "Room 220", kind: "class" },
    { start: "09:50", end: "10:35", what: "Geometry", where: "Room 301", kind: "class" },
    { start: "10:45", end: "11:35", what: "English 10", where: "Room 108", kind: "class" },
    { start: "12:20", end: "13:10", what: "Chemistry", where: "B wing lab", kind: "class" },
    { start: "15:15", end: "16:15", what: "Chess club", where: "Room 105", kind: "club" },
  ],
  4: [
    { start: "08:00", end: "08:50", what: "Spanish 2", where: "Room 119", kind: "class" },
    { start: "08:55", end: "09:45", what: "PE", where: "Gym", kind: "class" },
    { start: "09:50", end: "10:35", what: "Chemistry", where: "B wing lab", kind: "class" },
    { start: "10:45", end: "11:35", what: "AP World History", where: "Room 214", kind: "class" },
    { start: "12:20", end: "13:10", what: "English 10", where: "Room 108", kind: "class" },
    { start: "15:15", end: "16:30", what: "Output Club meeting", where: "Library", kind: "club" },
  ],
  5: [
    { start: "08:00", end: "08:50", what: "Geometry", where: "Room 301", kind: "class" },
    { start: "08:55", end: "09:45", what: "Chemistry", where: "B wing lab", kind: "class" },
    { start: "09:50", end: "10:35", what: "Computer Science", where: "Room 220", kind: "class" },
    { start: "10:45", end: "11:35", what: "AP World History", where: "Room 214", kind: "class" },
    { start: "12:20", end: "13:10", what: "Spanish 2", where: "Room 119", kind: "class" },
    { start: "15:15", end: "16:15", what: "Basketball", where: "Gym", kind: "club" },
  ],
};

const tests: Test[] = [
  { name: "Chemistry Unit 2 Test", day: "Thursday", when: "period 3" },
  { name: "Spanish vocab quiz", day: "Friday", when: "period 5" },
  { name: "Geometry proofs quiz", day: "Monday", when: "period 2" },
];

export function managebac() {
  return { source: "ManageBac", live: false, week };
}

export function veracross() {
  return { source: "Veracross", live: false, tests };
}
