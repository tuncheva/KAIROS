# KAIROS

<div align="center">
  <img src="public/logo_white.png" width="150" />
</div>

<div align="center">
  <strong>All-in-One Platform for Team Coordination, Project Management & Event Planning</strong>
</div>

## 📋 About KAIROS

KAIROS is a comprehensive digital platform that brings together everything you need to coordinate teams, manage projects, and organize events in one unified workspace. Streamline your workflow from initial planning to final execution without switching between multiple tools.

## 🎯 Why KAIROS?

Stop juggling disconnected apps and platforms. KAIROS provides a complete ecosystem where team coordination, task management, and event planning work seamlessly together. Whether you're managing a small team, organizing community events, or running complex projects, KAIROS has the tools you need in one integrated solution.

## 🚀 Everything You Need in One Platform

### Team Coordination
- **Unified Workspace** - Bring your entire team together in one space
- **Role-Based Access** - Control permissions with Moderator, Member, and Individual roles
- **Unique Access Codes** - Simple team onboarding with secure invitation system
- **Progress Monitoring** - Track team performance and project status in real-time

### Project Management
- **Interactive Timelines** - Visualize project progress with dynamic timelines
- **Task Management** - Create, assign, and track tasks with deadlines and priorities
- **Secure Documentation** - Store and protect project ideas and notes
- **Progress Analytics** - Monitor project health and team productivity

### Event Planning
- **Public Event Creation** - Design and promote events with custom details and images
- **RSVP Management** - Track attendance with smart confirmation system
- **Community Engagement** - Build audience interaction through likes and comments
- **Geographic Targeting** - Reach the right audience with location-based filtering

## 🛠 Built With Modern Technology

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS v4
- **Backend:** Next.js API, tRPC v11, TypeScript
- **Authentication:** NextAuth.js v5 with enterprise-grade security
- **Database:** PostgreSQL with Drizzle ORM
- **i18n:** next-intl (5 languages: EN, BG, ES, FR, DE)

## 📁 Project Structure

```
KAIROS/
├── public/                 # Static assets
├── src/
│   ├── app/                # Next.js App Router pages
│   ├── components/         # React components (feature-based)
│   ├── i18n/               # Internationalization config & messages
│   ├── lib/                # Utility libraries
│   ├── server/             # Server-side code (api, auth, db)
│   ├── styles/             # Global styles
│   └── trpc/               # tRPC client setup
├── .env.example            # Environment template
├── .github/                # CI/CD and contribution guidelines
├── components.json         # shadcn/ui configuration
├── drizzle.config.ts       # Database/ORM configuration
├── eslint.config.js        # Linting rules
├── next.config.ts          # Next.js configuration
├── package.json            # Dependencies & scripts
├── postcss.config.js       # PostCSS configuration
├── prettier.config.js      # Code formatting
├── tailwind.config.js      # Tailwind CSS theme
└── tsconfig.json           # TypeScript configuration
```

## 🚀 Getting Started

1. Clone the repository
2. Copy `.env.example` to `.env` and fill in your values
3. Install dependencies: `pnpm install`
4. Push database schema: `pnpm db:push`
5. Start development server: `pnpm dev`

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for detailed setup instructions.

## 👥 Development Team

**Alexandra Kostova** - Frontend Developer  
Email: alexandrakostova28@itpg-varna.bg

**Tina Tuncheva** - Backend Developer  
Email: tinatuncheva27@itpg-varna.bg

*Building innovative solutions for modern team collaboration*

---

<div align="center">
  <em>KAIROS. For the perfect timing.</em>
</div>