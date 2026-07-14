import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { meetings, tasks } from "@/lib/mockData";
import { departments, users } from "@/lib/orgPeopleData";
import { canonicalizeMeetingLoopState } from "@/lib/canonicalUsers";
import { canViewActivityLog, canViewMeeting, canViewTask, filterMeetingTasks } from "@/lib/permission";
import type { ActivityLog, Department, Meeting, Task, User } from "@/lib/types";

export type LocalMeetingLoopState = {
  version: 2;
  updatedAt: string;
  departments: Department[];
  users: User[];
  meetings: Meeting[];
  tasks: Task[];
  activityLogs: ActivityLog[];
  notificationReadIdsByUser: Record<string, string[]>;
  notificationReadIds?: string[];
  stateScope?: "full" | "visible";
};

export type LocalMeetingLoopStatePatch = Partial<Pick<LocalMeetingLoopState, "meetings" | "tasks" | "activityLogs">> & {
  stateScope?: "full" | "visible";
};

export type LocalMeetingLoopOrgPatch = Pick<LocalMeetingLoopState, "departments" | "users">;

const DATA_DIR = path.join(process.cwd(), ".local-data");
const DATA_FILE = path.join(DATA_DIR, "meeting-loop-state.json");
const STATE_VERSION = 2;

function createInitialState(): LocalMeetingLoopState {
  return {
    version: STATE_VERSION,
    updatedAt: new Date().toISOString(),
    departments,
    users,
    meetings,
    tasks,
    activityLogs: [],
    notificationReadIdsByUser: {}
  };
}

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

async function writeState(state: LocalMeetingLoopState) {
  await ensureDataDir();
  await writeFile(DATA_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function readLocalState(): Promise<LocalMeetingLoopState> {
  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as LocalMeetingLoopState;
    if (parsed.version !== STATE_VERSION) {
      const initialState = createInitialState();
      await writeState(initialState);
      return initialState;
    }
    return {
      ...createInitialState(),
      ...parsed,
      departments: parsed.departments?.length ? parsed.departments : departments,
      users: parsed.users?.length ? parsed.users : users,
      meetings: Array.isArray(parsed.meetings) ? parsed.meetings : meetings,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : tasks,
      activityLogs: Array.isArray(parsed.activityLogs) ? parsed.activityLogs : [],
      notificationReadIdsByUser: parsed.notificationReadIdsByUser && typeof parsed.notificationReadIdsByUser === "object" ? parsed.notificationReadIdsByUser : {}
    };
  } catch (error) {
    const initialState = createInitialState();
    await writeState(initialState);
    return initialState;
  }
}

export async function readVisibleLocalState(currentUser: User): Promise<LocalMeetingLoopState> {
  const state = canonicalizeMeetingLoopState(await readLocalState());
  const currentUserId = state.canonicalUserAliases[currentUser.id] ?? currentUser.id;
  const effectiveCurrentUser = state.users.find((user) => user.id === currentUserId) ?? currentUser;
  const currentReadIds = state.notificationReadIdsByUser[effectiveCurrentUser.id] ?? [];
  if (effectiveCurrentUser.role === "总裁") {
    return {
      ...state,
      notificationReadIds: currentReadIds,
      stateScope: "full"
    };
  }

  const permissionDirectory = { users: state.users, departments: state.departments };
  const visibleTasks = state.tasks.filter((task) => canViewTask(effectiveCurrentUser, task, state.meetings, permissionDirectory));
  const visibleTaskIds = new Set(visibleTasks.map((task) => task.id));
  const visibleMeetings = state.meetings
    .filter((meeting) => canViewMeeting(effectiveCurrentUser, meeting, visibleTasks))
    .map((meeting) => filterMeetingTasks(meeting, visibleTaskIds));
  const visibleMeetingIds = new Set(visibleMeetings.map((meeting) => meeting.id));
  const visibleActivityLogs = state.activityLogs.filter((log) => canViewActivityLog(effectiveCurrentUser, log, visibleMeetingIds, visibleTaskIds));

  return {
    ...state,
    meetings: visibleMeetings,
    tasks: visibleTasks,
    activityLogs: visibleActivityLogs,
    notificationReadIdsByUser: {
      [effectiveCurrentUser.id]: currentReadIds
    },
    notificationReadIds: currentReadIds,
    stateScope: "visible"
  };
}

export async function updateLocalState(patch: LocalMeetingLoopStatePatch): Promise<LocalMeetingLoopState> {
  const current = await readLocalState();
  const next: LocalMeetingLoopState = {
    ...current,
    meetings: Array.isArray(patch.meetings) ? patch.meetings : current.meetings,
    tasks: Array.isArray(patch.tasks) ? patch.tasks : current.tasks,
    activityLogs: Array.isArray(patch.activityLogs) ? patch.activityLogs : current.activityLogs,
    updatedAt: new Date().toISOString()
  };
  await writeState(next);
  return next;
}

export async function updateLocalOrgState(patch: LocalMeetingLoopOrgPatch): Promise<LocalMeetingLoopState> {
  const current = await readLocalState();
  const next: LocalMeetingLoopState = {
    ...current,
    departments: patch.departments,
    users: patch.users,
    updatedAt: new Date().toISOString()
  };
  await writeState(next);
  return next;
}

export async function updateLocalStateWith(mutator: (current: LocalMeetingLoopState) => LocalMeetingLoopState): Promise<LocalMeetingLoopState> {
  const current = await readLocalState();
  const next = {
    ...mutator(current),
    updatedAt: new Date().toISOString()
  };
  await writeState(next);
  return next;
}

export async function resetLocalState(): Promise<LocalMeetingLoopState> {
  const next = createInitialState();
  await writeState(next);
  return next;
}
