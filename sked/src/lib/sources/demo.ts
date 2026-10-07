import type { Assignment, ChatMsg, Mail } from "../google";
import { schoolDate } from "../time";

export function demoGoogle() {
  const assignments: Assignment[] = [
    { title: "Lab report: reaction rates", course: "Chemistry", due: schoolDate(1) },
    { title: "Chapter 6 reading notes", course: "AP World History", due: schoolDate(2) },
    { title: "Python loops practice", course: "Computer Science", due: schoolDate(4) },
    { title: "Personal narrative draft", course: "English 10", due: schoolDate(6) },
  ];
  const mail: Mail[] = [
    { from: "Ms. Park", subject: "Chem test moved to period 3", link: "#" },
    { from: "Student Council", subject: "Spirit week sign ups are open", link: "#" },
    { from: "Coach Lee", subject: "Basketball practice this Friday", link: "#" },
  ];
  const chat: ChatMsg[] = [
    { space: "Output Club", sender: "Jae", text: "can someone push the new login page before friday" },
    { space: "Chem study group", sender: "Minji", text: "anyone have the answers for #14? i got 2.3 mol" },
  ];
  return { connected: true, assignments, mail, chat, errors: [] as string[] };
}
