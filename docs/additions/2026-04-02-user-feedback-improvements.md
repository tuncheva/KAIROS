# Implementation Plan - User Feedback Improvements

**Date:** April 2, 2026  
**Status:** Planned  
**Overall Priority:** High - Addresses critical UX gaps and feature requests

---

## Phase 1: Internationalization & UI Fixes (High Priority)

### 1. Complete Bulgarian Language Translation
- **Objective**: Ensure all UI components support Bulgarian language selection
- **Current Issue**: Notes creation pop-up and other modals remain in English
- **Tasks**:
  1. Audit all i18n translation keys across the application
  2. Identify missing Bulgarian translations
  3. Add missing Bulgarian strings to translation files (`src/i18n/messages/`)
  4. Test all UI components with Bulgarian locale enabled
  5. Verify pop-ups, modals, and dialogs render correctly
- **Affected Components**: Notes modal, event creation, settings pages
- **Definition of Done**: All UI text displays in Bulgarian when selected

### 2. Fix Settings Page on Mobile
- **Objective**: Ensure settings page is fully responsive and functional on mobile
- **Current Issue**: Settings page layout and interactions broken on mobile devices
- **Tasks**:
  1. Audit settings page component (`src/app/settings/`)
  2. Review responsive design breakpoints
  3. Adjust layout for small screens
  4. Optimize form inputs and controls for touch
  5. Test on multiple mobile screen sizes (320px - 480px)
  6. Ensure all settings options are accessible
- **Affected Components**: Settings page
- **Definition of Done**: All settings functional and readable on mobile (iPhone, Android)

### 3. Implement Sticky Mobile Footer
- **Objective**: Make footer visible and sticky during scroll on mobile
- **Current Issue**: Footer only appears at bottom, not visible during scroll
- **Tasks**:
  1. Locate footer component in layout
  2. Add CSS `position: sticky` or `position: fixed` styling
  3. Adjust z-index to prevent overlapping content
  4. Test on various mobile devices and screen sizes
  5. Ensure footer doesn't cover important content
- **Affected Components**: Mobile footer
- **Definition of Done**: Footer remains visible and accessible while scrolling

### 4. Fix Mobile Timeline Layout
- **Objective**: Improve timeline display on mobile to flow vertically downward
- **Current Issue**: Timeline appearance is awkward on mobile
- **Tasks**:
  1. Review timeline component (`src/components/progress/`)
  2. Ensure vertical layout for mobile screens
  3. Optimize spacing and alignment
  4. Make touch targets appropriate size (min 44px)
  5. Test on multiple mobile devices
- **Affected Components**: Timeline component
- **Definition of Done**: Timeline displays and functions properly on mobile

---

## Phase 2: Calendar & Event Enhancements (High Priority)

### 5. Implement Calendar Date-Based Filters
- **Objective**: Add quick-filter buttons to calendar view
- **Current Issue**: No easy way to filter events by date ranges
- **Required Filters**:
  - Today
  - Yesterday
  - Tomorrow
  - This week
  - Last week
  - Custom date range
- **Tasks**:
  1. Design filter UI component
  2. Create filter logic and state management
  3. Implement date range calculations
  4. Add filter buttons/controls to calendar header
  5. Update calendar query to apply filters
  6. Test filter combinations
- **Affected Components**: Calendar header, calendar view, event queries
- **Definition of Done**: Users can quickly filter events by predefined date ranges

### 6. Implement Event Pagination with Lazy Loading
- **Objective**: Limit initial event load to 10 per page, load more on scroll
- **Current Issue**: Loading all events causes performance issues
- **Technical Tasks**:
  1. Modify backend event query to support pagination
  2. Add `limit` and `offset` parameters to API endpoint
  3. Implement infinite scroll/lazy loading on frontend
  4. Load 10 events initially
  5. Trigger load on scroll to trigger next batch
  6. Add loading indicator
  7. Optimize database queries
  8. Test with large event datasets
- **Affected Components**: Calendar view, event API endpoints
- **Definition of Done**: Events load in batches of 10, no performance degradation

### 7. Add Photo/Image Support to Events
- **Objective**: Allow users to attach images to events
- **Tasks**:
  1. Update event schema to include image field(s)
  2. Implement image upload in event creation form
  3. Use existing `uploadthing` integration
  4. Display image thumbnail in event creation preview
  5. Show image in event details view
  6. Allow image update/replacement
  7. Handle image deletion
  8. Decide on single vs. multiple images (recommend: single for MVP)
- **Affected Components**: Event creation form, event details, database schema
- **Definition of Done**: Users can upload and view images on events

### 8. Enable Direct Messaging to Event Creator
- **Objective**: Allow private messaging to event creator separate from comments
- **Tasks**:
  1. Add "Message Creator" button to event details
  2. Create private message flow
  3. Route to existing chat system
  4. Add notification to creator on private message
  5. Ensure privacy - only creator and sender can access
  6. Test message delivery and notifications
- **Affected Components**: Event details, chat system, notifications
- **Definition of Done**: Users can send private messages to event creators

---

## Phase 3: Notes & Calendar Integration (Medium Priority)

### 9. Add Notes to Calendar
- **Objective**: Allow users to add notes as calendar entries (not just tasks)
- **Current Issue**: Calendar only shows events/tasks, not notes
- **Tasks**:
  1. Add checkbox in notes creation form: "Add this note to calendar"
  2. Add date/time picker for calendar note scheduling
  3. Update notes schema to include optional calendar date/time
  4. Modify calendar view to display notes alongside events
  5. Style notes differently from events for distinction
  6. Allow editing scheduled date/time
  7. Test calendar display with mixed events and notes
- **Affected Components**: Notes creation form, calendar view, notes schema
- **Definition of Done**: Users can schedule notes on calendar with date/time

---

## Phase 4: Project & Organization Management (High Priority)

### 10. Redesign Member Invitation - Multiple Methods
- **Objective**: Support multiple ways to invite members to projects/organizations
- **Current Issue**: Unclear invitation process; only one method available
- **Required Methods**:
  1. Email invitation link
  2. Shareable invitation code/token
  3. QR code generation
  4. CSV bulk upload (for larger organizations)
  5. Organization member dropdown (if already part of organization)
- **Tasks**:
  1. Design invitation UI flow
  2. Create invitation generation backend
  3. Implement email invitation with link
  4. Generate unique invitation codes
  5. Implement QR code generation using library
  6. Create CSV upload and validation
  7. Implement member dropdown with organization search
  8. Add expiration to invitation codes
  9. Track invitation status
  10. Test all invitation methods
- **Affected Components**: Organization/project settings, member management, API
- **Definition of Done**: All invitation methods functional and documented

### 11. Clarify Member Invitation Documentation
- **Objective**: Create clear documentation for member invitation flow
- **Tasks**:
  1. Document organization vs. project hierarchy
  2. Clarify when organization invitation is required
  3. Document discoverable vs. manual invitation
  4. Create user-facing documentation
  5. Create developer documentation
- **Definition of Done**: Users and developers understand invitation flow

### Phase 4 Remaining Work (Current)
- **Still pending before Phase 4 can be called complete**:
  1. Replace external QR generation (`api.qrserver.com`) with local QR generation library/output in workspace invite UI
  2. Run full verification pass for invite methods together (email invite, link/code, QR, CSV, org-member quick invite, status history)
  3. Keep invitation docs aligned with final QR implementation details and final UI wording

---

## Phase 5: Chat & Communication (Medium Priority)

### 12. Improve Chat Participant Selection
- **Objective**: Reduce friction when selecting participants in chat
- **Current Issue**: Manual email entry is cumbersome
- **Tasks**:
  1. Add autocomplete/search to participant field
  2. Display known contacts from organization/projects
  3. Show recent contacts at top
  4. Add "Add from project members" quick action
  5. Add "Add from organization members" quick action
  6. Test with large contact lists
- **Affected Components**: Chat creation/settings, participant selection
- **Definition of Done**: Users can quickly select participants with autocomplete

---

## Phase 6: Future Enhancements (Low Priority - Post-MVP)

### 13. Implement Online/Streaming Events
- **Objective**: Support virtual streaming events similar to Twitch
- **Features**:
  - Host can stream to attendees
  - Only host can speak/stream
  - Attendees can watch stream
  - Real-time chat for attendees
  - Stream recording (optional)
- **Tasks**:
  1. Research streaming solution (e.g., daily.co, Twitch API, or custom)
  2. Design streaming UX
  3. Integrate streaming provider
  4. Implement host-only controls
  5. Implement attendee chat
  6. Add event type selection (in-person vs. online stream)
  7. Test stream performance
- **Technical Considerations**: Use existing WebSocket infrastructure or integrate third-party
- **Definition of Done**: Users can create and attend streaming events

---

## Implementation Priority Matrix

| # | Feature | Phase | Priority | Effort | Impact | Dependencies |
|---|---------|-------|----------|--------|--------|--------------|
| 1 | Bulgarian i18n | 1 | High | Medium | High | None |
| 2 | Mobile settings | 1 | High | Medium | High | None |
| 3 | Sticky footer | 1 | Low | Low | Low | None |
| 4 | Mobile timeline | 1 | Low | Low | Low | None |
| 5 | Calendar filters | 2 | High | Medium | High | Phase 2 start |
| 6 | Event pagination | 2 | High | High | High | None |
| 7 | Event photos | 2 | Medium | Medium | Medium | uploadthing |
| 8 | Direct messaging | 2 | Medium | Medium | Medium | Chat system |
| 9 | Notes to calendar | 3 | Medium | Medium | Medium | #5 |
| 10 | Multi-method invites | 4 | High | High | High | None |
| 11 | Invite documentation | 4 | Medium | Low | Medium | #10 |
| 12 | Chat participants | 5 | Medium | Low | Medium | None |
| 13 | Streaming events | 6 | Low | Very High | Medium | None |

---

## Success Criteria

- [ ] All Bulgarian translations complete and tested
- [ ] Mobile views functional on iOS (iPhone 12+) and Android (Samsung S21+)
- [ ] Calendar filters working correctly
- [ ] Event pagination improves load time by 50%+
- [ ] All invitation methods tested and documented
- [ ] No performance degradation
- [ ] User testing confirms improved UX

---

## Notes

- **User Quote**: "I hope you still love me, sometimes I can be quite awful/annoying... Pleaseeee"
- Consider user feedback as validation of product-market fit
- Prioritize mobile experience based on user complaints
- Streaming events can be deferred to post-MVP phase

