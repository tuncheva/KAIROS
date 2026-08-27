import { relations } from "drizzle-orm";
import { users, accounts, sessions } from "./users";
import { organizations, organizationMembers } from "./organizations";
import { projects, projectCollaborators } from "./projects";
import { tasks, taskComments, taskActivityLog } from "./tasks";
import { notebooks, stickyNotes, noteShares } from "./notes";
import {
  events,
  eventCoHosts,
  eventComments,
  eventLikes,
  eventRsvps,
  eventSaves,
} from "./events";
import {
  conversationParticipants,
  directConversations,
  directMessageAttachments,
  directMessageReactions,
  directMessages,
} from "./chat";
import { notifications } from "./notifications";

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  notes: many(stickyNotes),
  authoredEvents: many(events),
  eventComments: many(eventComments),
  eventLikes: many(eventLikes),
  createdProjects: many(projects),
  projectCollaborations: many(projectCollaborators),
  assignedTasks: many(tasks),
  createdTasks: many(tasks),
  taskComments: many(taskComments),
  taskActivities: many(taskActivityLog),
  organizationsOwned: many(organizations),
  organizationMemberships: many(organizationMembers),
  notifications: many(notifications),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  creator: one(users, { fields: [organizations.createdById], references: [users.id] }),
  members: many(organizationMembers),
  projects: many(projects),
}));

export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, { fields: [organizationMembers.organizationId], references: [organizations.id] }),
  user: one(users, { fields: [organizationMembers.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  creator: one(users, { fields: [projects.createdById], references: [users.id] }),
  organization: one(organizations, { fields: [projects.organizationId], references: [organizations.id] }),
  tasks: many(tasks),
  collaborators: many(projectCollaborators),
}));

export const projectCollaboratorsRelations = relations(projectCollaborators, ({ one }) => ({
  project: one(projects, { fields: [projectCollaborators.projectId], references: [projects.id] }),
  user: one(users, { fields: [projectCollaborators.collaboratorId], references: [users.id] }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  assignedTo: one(users, { fields: [tasks.assignedToId], references: [users.id] }),
  creator: one(users, { fields: [tasks.createdById], references: [users.id] }),
  comments: many(taskComments),
  activityLog: many(taskActivityLog),
}));

export const taskCommentsRelations = relations(taskComments, ({ one }) => ({
  task: one(tasks, { fields: [taskComments.taskId], references: [tasks.id] }),
  author: one(users, { fields: [taskComments.createdById], references: [users.id] }),
}));

export const taskActivityLogRelations = relations(taskActivityLog, ({ one }) => ({
  task: one(tasks, { fields: [taskActivityLog.taskId], references: [tasks.id] }),
  user: one(users, { fields: [taskActivityLog.userId], references: [users.id] }),
}));

export const notebooksRelations = relations(notebooks, ({ one, many }) => ({
  creator: one(users, { fields: [notebooks.createdById], references: [users.id] }),
  notes: many(stickyNotes),
}));

export const stickyNotesRelations = relations(stickyNotes, ({ one, many }) => ({
  author: one(users, { fields: [stickyNotes.createdById], references: [users.id] }),
  notebook: one(notebooks, { fields: [stickyNotes.notebookId], references: [notebooks.id] }),
  shares: many(noteShares),
}));

export const noteSharesRelations = relations(noteShares, ({ one }) => ({
  note: one(stickyNotes, { fields: [noteShares.noteId], references: [stickyNotes.id] }),
  sharedWith: one(users, { fields: [noteShares.sharedWithId], references: [users.id] }),
  sharedBy: one(users, { fields: [noteShares.sharedById], references: [users.id] }),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  author: one(users, { fields: [events.createdById], references: [users.id] }),
  comments: many(eventComments),
  likes: many(eventLikes),
  rsvps: many(eventRsvps),
  coHosts: many(eventCoHosts),
  saves: many(eventSaves),
}));

export const eventCoHostsRelations = relations(eventCoHosts, ({ one }) => ({
  event: one(events, { fields: [eventCoHosts.eventId], references: [events.id] }),
  user: one(users, { fields: [eventCoHosts.userId], references: [users.id] }),
}));

export const eventSavesRelations = relations(eventSaves, ({ one }) => ({
  event: one(events, { fields: [eventSaves.eventId], references: [events.id] }),
  user: one(users, { fields: [eventSaves.userId], references: [users.id] }),
}));

export const eventRsvpsRelations = relations(eventRsvps, ({ one }) => ({
  event: one(events, { fields: [eventRsvps.eventId], references: [events.id] }),
  user: one(users, { fields: [eventRsvps.userId], references: [users.id] }),
}));

export const eventCommentsRelations = relations(eventComments, ({ one, many }) => ({
  event: one(events, { fields: [eventComments.eventId], references: [events.id] }),
  author: one(users, { fields: [eventComments.createdById], references: [users.id] }),
  parent: one(eventComments, {
    fields: [eventComments.parentId],
    references: [eventComments.id],
    relationName: "commentReplies",
  }),
  replies: many(eventComments, { relationName: "commentReplies" }),
}));

export const eventLikesRelations = relations(eventLikes, ({ one }) => ({
  event: one(events, { fields: [eventLikes.eventId], references: [events.id] }),
  user: one(users, { fields: [eventLikes.createdById], references: [users.id] }),
}));

export const directConversationsRelations = relations(directConversations, ({ one, many }) => ({
  project: one(projects, { fields: [directConversations.projectId], references: [projects.id] }),
  organization: one(organizations, { fields: [directConversations.organizationId], references: [organizations.id] }),
  userOne: one(users, { fields: [directConversations.userOneId], references: [users.id] }),
  userTwo: one(users, { fields: [directConversations.userTwoId], references: [users.id] }),
  messages: many(directMessages),
  participants: many(conversationParticipants),
}));

export const directMessagesRelations = relations(directMessages, ({ one, many }) => ({
  conversation: one(directConversations, { fields: [directMessages.conversationId], references: [directConversations.id] }),
  sender: one(users, { fields: [directMessages.senderId], references: [users.id] }),
  /* Named relation: without it drizzle cannot tell which side of the
     self-reference each field belongs to. */
  replyTo: one(directMessages, {
    fields: [directMessages.replyToId],
    references: [directMessages.id],
    relationName: "messageReply",
  }),
  replies: many(directMessages, { relationName: "messageReply" }),
  attachments: many(directMessageAttachments),
  reactions: many(directMessageReactions),
}));

export const conversationParticipantsRelations = relations(conversationParticipants, ({ one }) => ({
  conversation: one(directConversations, { fields: [conversationParticipants.conversationId], references: [directConversations.id] }),
  user: one(users, { fields: [conversationParticipants.userId], references: [users.id] }),
}));

export const directMessageAttachmentsRelations = relations(directMessageAttachments, ({ one }) => ({
  message: one(directMessages, { fields: [directMessageAttachments.messageId], references: [directMessages.id] }),
}));

export const directMessageReactionsRelations = relations(directMessageReactions, ({ one }) => ({
  message: one(directMessages, { fields: [directMessageReactions.messageId], references: [directMessages.id] }),
  user: one(users, { fields: [directMessageReactions.userId], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));
