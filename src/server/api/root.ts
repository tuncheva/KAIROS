
import { eventRouter } from "~/server/api/routers/event";
import { noteRouter } from "~/server/api/routers/note";
import { projectRouter } from "~/server/api/routers/project";
import { taskRouter } from "~/server/api/routers/task";
import { calendarRouter } from "~/server/api/routers/calendar";
import { organizationRouter } from "~/server/api/routers/organization"; // NEW
import { userRouter } from "~/server/api/routers/user";
import { notificationRouter } from "~/server/api/routers/notification"; // NEW
import { settingsRouter } from "~/server/api/routers/settings";
import { authRouter } from "~/server/api/routers/auth";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { chatRouter } from "~/server/api/routers/chat";
import { agentRouter } from "~/server/api/routers/agent";
import { billingRouter } from "~/server/api/routers/billing";
import { integrationRouter } from "~/server/api/routers/integration";

export const appRouter = createTRPCRouter({
  event: eventRouter,
  settings: settingsRouter,
  note: noteRouter,
  project: projectRouter,
  task: taskRouter,
  calendar: calendarRouter,
  organization: organizationRouter,
  user: userRouter,
  auth: authRouter,
  notification: notificationRouter,
  chat: chatRouter,
  agent: agentRouter,
  billing: billingRouter,
  integration: integrationRouter,
});

export type AppRouter = typeof appRouter;


export const createCaller = createCallerFactory(appRouter);