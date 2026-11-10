# Диаграми на дипломната

GitHub показва диаграмите по-долу директно. Генерирано от `src/*.mmd` – редактирайте изходните файлове.

## Фигура 1. SWOT анализ на платформата KAIROS

Изходен файл: [`src/01-swot.mmd`](src/01-swot.mmd) · [PNG](out/01-swot.png) · [SVG](out/01-swot.svg) · [HTML](out/01-swot.html)

```mermaid
%% Фигура 1 – SWOT анализ (по т. 1.7 от дипломната)
block-beta
  columns 2
  S["<b>Силни страни</b><br>• Контрол върху ИИ: по подразбиране всяка промяна се одобрява;<br>• Защита на данните: заключените бележки не стигат до модела;<br>• Задачи, бележки и събития в една среда, на български."]
  W["<b>Слаби страни</b><br>• По-слаби ИИ модели от тези на конкурентите;<br>• Зависимост от външни доставчици на модели;<br>• Малко интеграции, няма нативно мобилно приложение;<br>• Ниска популярност."]
  O["<b>Възможности</b><br>• Недоверие към ИИ, който действа без разрешение;<br>• Недоволство от отделното заплащане на ИИ;<br>• Изискване за човешки контрол в ЕС;<br>• Няма конкурент, съчетал събития и екипна работа."]
  T["<b>Заплахи</b><br>• Конкурентите бързо добавят ИИ и подобен контрол;<br>• Поскъпване и промени при доставчиците на модели;<br>• Изискванията за лични данни ограничават доставчиците."]
  style S fill:#e3f3ea,stroke:#1f6b45
  style W fill:#fbe9e7,stroke:#a3322b
  style O fill:#e8eef8,stroke:#2c4f8f
  style T fill:#fbf3df,stroke:#a86400
```

## Фигура 2. Use Case диаграма на системата KAIROS

Изходен файл: [`src/02-use-case.mmd`](src/02-use-case.mmd) · [PNG](out/02-use-case.png) · [SVG](out/02-use-case.svg) · [HTML](out/02-use-case.html)

```mermaid
%% Фигура 2 – Use Case диаграма
flowchart LR
  guest(["👤 Гост"])
  member(["👤 Член на екипа"])
  admin(["👤 Администратор<br>на организацията"])
  ai(["🤖 ИИ агенти<br>Mentor и специалистите"])
  sched(["⏱ Планировчик<br>по разписание"])
  subgraph K["Система KAIROS"]
    subgraph ACC["Достъп"]
      uc1(["Регистрация и вход<br>парола / OAuth"])
      uc2(["Управление на роли и права"])
    end
    subgraph WRK["Работа по проекти"]
      uc3(["Преглед на анализи и напредък"])
      uc4(["Управление на проекти и задачи"])
      uc5(["Водене и споделяне на бележки"])
      uc6(["Създаване и публикуване на събития"])
      uc12(["Лични и проектни разговори в чата"])
    end
    subgraph AIF["ИИ функции"]
      uc7(["Разговор с ИИ асистента"])
      uc8(["Потвърждаване или отмяна на ИИ план"])
      uc9(["Питане върху качени документи"])
    end
    subgraph EVN["Събития и известия"]
      uc10(["Получаване на известия и брифинги"])
      uc11(["Разглеждане на събития<br>RSVP след вход"])
    end
  end
  member -.->|"наследява"| guest
  admin -.->|"наследява"| member
  guest --- uc1
  guest --- uc11
  admin --- uc2
  member --- uc3
  member --- uc4
  member --- uc5
  member --- uc6
  member --- uc7
  member --- uc10
  member --- uc12
  uc8 -.->|"«extend»"| uc7
  uc9 -.->|"«extend»"| uc7
  ai --- uc7
  ai --- uc9
  ai --- uc10
  sched --- uc10
```

## Фигура 3. Site Map на платформата KAIROS

Изходен файл: [`src/03-site-map.mmd`](src/03-site-map.mmd) · [PNG](out/03-site-map.png) · [SVG](out/03-site-map.svg) · [HTML](out/03-site-map.html)

```mermaid
%% Фигура 3 – Site Map (пътищата се сверяват с src/app)
flowchart TB
  root["kairosonline.net"]
  subgraph PUB["Публична част"]
    direction TB
    p1["/ – начало · /about · /careers"] --- p2["/pricing · /contact"] --- p3["/privacy · /terms · /events/[id]"]
  end
  subgraph ACC["Достъп"]
    direction TB
    a1["/security · /verify-email · /verify-login"] --- a2["/auth-error · /invite/[token] · /invite-optout/[token]"]
  end
  subgraph WRK["Работна среда"]
    direction TB
    w1["/dashboard · /projects · /progress · /calendar"] --- w2["/notes · /notes/new · /notes/[noteId]<br>/notes/[noteId]/recover"] --- w3["/orgs · /join/[code]"] --- w4["/profile/[userId] · /settings"]
  end
  subgraph COM["Комуникация и ИИ"]
    direction TB
    c1["/chat · /chat/[conversationId]"] --- c2["/chat/ai · /publish"]
  end
  subgraph API["Служебни крайни точки"]
    direction TB
    x1["/api/trpc/[trpc] · /api/auth/[...nextauth] · /api/ai/chat"]
    x2["/api/calendar/feed/[token] · /api/calendar/google/connect · /api/calendar/google/callback"]
    x3["/api/export/[format] · /api/uploadthing · /api/ws/token · /api/internal/ai/run-schedules"]
    x4["/api/stripe/webhook · /api/invite-optout/[token] · /api/account-switch/list · /api/account-switch/register"]
  end
  root --> PUB
  root --> ACC
  root --> WRK
  root --> COM
  root -.-> API
```

## Фигура 4. Многослойна архитектура на платформата KAIROS

Изходен файл: [`src/04-architecture.mmd`](src/04-architecture.mmd) · [PNG](out/04-architecture.png) · [SVG](out/04-architecture.svg) · [HTML](out/04-architecture.html)

```mermaid
%% Фигура 4 – Многослойна архитектура (числата се сверяват с кода)
flowchart LR
  subgraph STACK[" "]
    direction TB
    l1["<b>Презентационен слой</b><br>Next.js 16 · React 19 · Tailwind CSS 4<br>GSAP · Chart.js · next-intl (2 езика: български и английски)"]
    l2["<b>Комуникационен слой</b><br>tRPC v11 (17 рутера) · TanStack Query<br>Next.js API Routes · Socket.IO (отделен сървър)"]
    l3["<b>Бизнес логика и ИИ</b><br>Оркестратор · 6 разговорни агента: Mentor и 5 специализирани<br>цикъл с инструменти · RAG над документи · дълготрайна памет<br>4 планирани агента и потребителски графици · поправка на JSON · Zod схеми"]
    l4["<b>Слой за данни</b><br>PostgreSQL (59 таблици, pgvector) · Drizzle ORM<br>48 миграции · Redis (по избор: лимити, pub/sub)"]
    l5["<b>Външни услуги</b><br>Доставчик на езикови модели (OpenAI-съвместим) · OAuth 2.0 (Google, Microsoft)<br>Resend · Stripe · UploadThing · OpenStreetMap · Google Calendar · Web Push"]
    l1 <--> l2 <--> l3 <--> l4 <--> l5
  end
  SEC["<b>Сигурност</b><br>(пресичащ слой)<br><br>NextAuth.js v5<br>Argon2id<br>JWT сесии<br>Zod валидация<br>RBAC с 8 права<br>AES-256-GCM<br>PBKDF2 (210 000 итерации)<br>лимити с плъзгащ прозорец<br>HTTP заглавия"]
  SEC -.- STACK
  style STACK fill:transparent,stroke:transparent
  style SEC fill:#e3f3ea,stroke:#1f6b45
  style l1 fill:#e8eef8,stroke:#2c4f8f
  style l2 fill:#efe8f8,stroke:#6a4c9c
  style l3 fill:#f6e6f3,stroke:#9b3f8a
  style l4 fill:#fbefe0,stroke:#b8741a
  style l5 fill:#eeeeee,stroke:#555555
```

## Фигура 5. Домейни в релационния модел на данните

Изходен файл: [`src/05-data-domains.mmd`](src/05-data-domains.mmd) · [PNG](out/05-data-domains.png) · [SVG](out/05-data-domains.svg) · [HTML](out/05-data-domains.html)

```mermaid
%% Фигура 5 – Домейни в релационния модел (проверка: всички таблици точно веднъж)
flowchart LR
  subgraph D1["Потребители и достъп"]
    d1["user · account · session<br>verification_token · verification_code<br>two_factor_challenge · user_follow<br>push_subscriptions"]
  end
  subgraph D2["Организации"]
    d2["organizations · organization_members<br>organization_roles · organization_invites<br>organization_join_codes · invite_suppressions"]
  end
  subgraph D3["Проекти и задачи"]
    d3["projects · project_collaborators<br>tasks · task_dependencies<br>task_comments · task_activity_log"]
  end
  subgraph D4["Бележки"]
    d4["notebooks · sticky_notes · note_shares"]
  end
  subgraph D5["Събития"]
    d5["event · event_rsvp · event_like<br>event_comment · event_save · event_cohost"]
  end
  subgraph D6["Комуникация"]
    d6["direct_conversations · conversation_participants<br>direct_messages · direct_message_attachments<br>direct_message_reactions · notifications"]
  end
  subgraph D7["ИИ слой"]
    d7["ai_conversations · ai_messages · ai_user_memory<br>ai_findings · ai_schedules<br>ai_custom_schedules · ai_reminders"]
  end
  subgraph D9["ИИ слой: чернови и прилагания на пишещите агенти"]
    d9["agent_task_planner_drafts · agent_task_planner_applies<br>agent_notes_vault_drafts · agent_notes_vault_applies<br>agent_events_publisher_drafts · agent_events_publisher_applies<br>agent_org_admin_drafts · agent_org_admin_applies<br>agent_project_manager_drafts · agent_project_manager_applies"]
  end
  subgraph D8["Интеграции"]
    d8["documents · document_chunks<br>api_keys · webhooks · webhook_deliveries<br>calendar_connections · external_events"]
  end
  D1 ~~~ D2 ~~~ D3 ~~~ D4
  D5 ~~~ D6 ~~~ D7 ~~~ D8
  D7 ~~~ D9
```

## Фигура 6. Архитектура на многоагентната система на KAIROS

Изходен файл: [`src/06-agent-architecture.mmd`](src/06-agent-architecture.mmd) · [PNG](out/06-agent-architecture.png) · [SVG](out/06-agent-architecture.svg) · [HTML](out/06-agent-architecture.html)

```mermaid
%% Фигура 6 – Архитектура на многоагентната система
flowchart TB
  user(["Потребител"])
  rl["Ограничител на заявките · дневен лимит"]
  orch["Оркестратор · един сървърен ход"]
  mentor["Mentor · отговаря сам или делегира"]
  tools[("Инструменти за четене<br>с проверка на правата")]
  answer(["Отговор към потребителя"])
  subgraph SPEC["Специализирани агенти · без инструменти, получават контекстен пакет"]
    direction LR
    od["Odysseus<br>задачи"]
    mn["Mnemosyne<br>бележки"]
    ir["Iris<br>събития"]
    so["Solon<br>организация"]
    da["Daedalus<br>проекти"]
  end
  plan["План (JSON), валидиран със Zod"]
  life["Draft → Confirm → Apply → Undo<br>отмяна: само задачи и бележки"]
  subgraph SCH["По график, отделно от разговора"]
    direction LR
    tick["Планировчик в WS сървъра<br>на всеки 5 минути"] --> agents4["Hemera · Argus · Nestor · Clio<br>потребителски графици · напомняния"] --> ntf(["Известие в приложението<br>и/или имейл"])
  end
  user --> rl --> orch --> mentor
  mentor <--> tools
  mentor -->|"отговор"| answer
  mentor -->|"делегиране, до 3 агента"| SPEC
  orch -.->|"агент, избран от потребителя<br>(без Mentor)"| SPEC
  SPEC --> plan --> life
```

## Фигура 7, 19. Последователност на един ход на многоагентната система

Изходен файл: [`src/07-agent-turn.mmd`](src/07-agent-turn.mmd) · [PNG](out/07-agent-turn.png) · [SVG](out/07-agent-turn.svg) · [HTML](out/07-agent-turn.html)

```mermaid
%% Фигура 7 и 19 – Последователност на един ход (стъпки 4–8: цикъл с инструменти; 10: валидация; 14–17: жизнен цикъл)
sequenceDiagram
  autonumber
  actor U as Потребител
  participant UI as Интерфейс
  participant S as Сървър /api/ai/chat
  participant M as Mentor (модел)
  participant DB as PostgreSQL
  participant A as Специализирани агенти (до 3, паралелно)
  U->>UI: съобщение
  UI->>S: заявка
  S->>S: ограничител на заявките
  S->>M: промпт и контекст на страницата
  M->>S: извикване на инструмент
  S->>S: проверка на правата
  S->>DB: четене
  S-->>M: резултат (до 12 000 знака)
  Note over S,M: стъпки 4–8 се повтарят до 8 пъти, най-много 90 s
  M-->>S: решение (JSON)
  S->>S: валидация със Zod, при грешка – поправка
  alt отговор
    S-->>UI: отговор
  else делегиране
    S->>A: контекстен пакет
    A-->>S: план (JSON), валидиран
    S->>DB: записва черновата
    S-->>UI: показва черновата
    U->>UI: потвърждава
    UI->>S: прилага (авторизация на всяка операция,<br>образ преди промяната за задачи и бележки)
  end
```

## Фигура 8, 18. Жизнен цикъл на плана на пишещ агент: чернова, потвърждение, прилагане и отмяна

Изходен файл: [`src/08-plan-lifecycle.mmd`](src/08-plan-lifecycle.mmd) · [PNG](out/08-plan-lifecycle.png) · [SVG](out/08-plan-lifecycle.svg) · [HTML](out/08-plan-lifecycle.html)

```mermaid
%% Фигура 8 и 18 – Жизнен цикъл на плана (статуси от src/server/db/schemas/enums.ts)
stateDiagram-v2
  direction TB
  [*] --> draft: агентът връща план, валидиран със Zod
  draft --> confirmed: потребителят потвърждава
  confirmed --> expired: токенът за потвърждение изтича след 10 минути, прилагането се отказва
  confirmed --> applied: прилагане с авторизация, за задачи и бележки се записва образ преди промяната
  draft --> confirmed: автоматично, само малък план за задачи или бележки, ако е включено
  applied --> undone: Undo до 10 минути, задачи и бележки, без изтривания
  expired --> [*]
  applied --> [*]
  undone --> [*]
  state "Чернова (draft)" as draft
  state "Потвърдена (confirmed)" as confirmed
  state "Изтекъл токен (expired, не се записва)" as expired
  state "Приложена (applied)" as applied
  state "Отменена (Undo, не е статус в базата)" as undone
```

## Фигура 9. Конвейер за извличане с обогатяване над качени документи

Изходен файл: [`src/09-rag.mmd`](src/09-rag.mmd) · [PNG](out/09-rag.png) · [SVG](out/09-rag.svg) · [HTML](out/09-rag.html)

```mermaid
%% Фигура 9 – Извличане с обогатяване над документи
flowchart TB
  subgraph IN["Качване"]
    direction LR
    f["Файл (PDF или текст)"] --> x["Извличане на текста<br>pdfjs-dist"] --> c["Пасажи с препокриване<br>и номер на страницата"]
    c --> e["Вектори 2048, асинхронно<br>ако има модел за embeddings"]
  end
  st[("PostgreSQL<br>document_chunks · pgvector")]
  c --> st
  e --> st
  subgraph Q["Въпрос"]
    direction TB
    q["Въпрос към Mentor"] --> t["Инструмент за търсене<br>проверка на достъпа"]
    t --> v["Векторно търсене<br>косинусова близост"]
    t --> ft["Пълнотекстово търсене"]
    v --> rrf["Reciprocal Rank Fusion<br>k = 60"]
    ft --> rrf
    rrf --> top["5 пасажа по подразбиране<br>(до 10)"] --> ans["Отговор с цитат<br>файл и страница"]
  end
  st --> v
  st --> ft
```

## Фигура 10. Поток на планираните агенти: детерминистично откриване и формулировка от модела

Изходен файл: [`src/10-scheduled-agents.mmd`](src/10-scheduled-agents.mmd) · [PNG](out/10-scheduled-agents.png) · [SVG](out/10-scheduled-agents.svg) · [HTML](out/10-scheduled-agents.html)

```mermaid
%% Фигура 10 – Поток на планираните агенти
flowchart TB
  tick["Планировчик в WS сървъра<br>на всеки 5 минути"] --> ep["/api/internal/ai/run-schedules"]
  ep --> due["Графици, включени от потребителя<br>и наближили по час или среща"]
  due --> det["Детерминистично откриване<br>заявки към базата, без модел"]
  det --> fnd[("ai_findings<br>с отпечатък, без повторения<br>Argus · Hemera")]
  det --> empty{"Има ли какво<br>да се съобщи?"}
  fnd --> empty
  empty -->|"не"| quiet["Нищо не се изпраща"]
  empty -->|"да"| lim{"Остава ли от дневния<br>системен лимит?"}
  lim -->|"да"| llm["Моделът формулира текста<br>Hemera · Nestor · Clio"]
  lim -->|"не"| raw["Резервен текст<br>само от фактите"]
  llm --> ntf["Известие в приложението<br>и Web Push или имейл"]
  raw --> ntf
```

## Фигура 11. Функционално взаимодействие между ролите в платформата KAIROS

Изходен файл: [`src/11-roles.mmd`](src/11-roles.mmd) · [PNG](out/11-roles.png) · [SVG](out/11-roles.svg) · [HTML](out/11-roles.html)

```mermaid
%% Фигура 11 – Функционално взаимодействие между ролите (т. 2.9)
flowchart LR
  g(["Гост"]) --> g1["Разглежда публичната информация<br>събития, страници"]
  v(["Наблюдател в организация<br>шаблони mentor и guest"]) --> v1["Преглежда проектите<br>на организацията, без промени"]
  m(["Член на екип"]) --> m1["Създава проекти и задачи"]
  m --> m2["Проследява напредъка"]
  m --> m3["Води бележки"]
  m --> m4["Използва ИИ асистента"]
  a(["Администратор на организация"]) --> a1["Управлява членства и покани"]
  a --> a2["Задава роли и осемте права"]
  a --> a3["Създава собствени роли"]
  a --> a4["Конфигурира работната среда"]
  v -.->|"има и правата на"| g
  m -.->|"има и правата на"| v
  a -.->|"има и правата на"| m
```

## Фигура 12. Архитектура на известията извън приложението

Изходен файл: [`src/12-push-architecture.mmd`](src/12-push-architecture.mmd) · [PNG](out/12-push-architecture.png) · [SVG](out/12-push-architecture.svg) · [HTML](out/12-push-architecture.html)

```mermaid
%% Фигура 12 – Архитектура на известията извън приложението
flowchart TB
  act["Действие в KAIROS<br>tRPC · ИИ агенти · планировчик · Stripe webhook"] --> disp
  subgraph APP["Next.js сървър"]
    disp["dispatch.notify()<br>предпочитания · обединяване"] -->|"schedulePush() чрез after()"| push["web-push<br>VAPID · aes128gcm"]
  end
  db[("PostgreSQL<br>notifications · push_subscriptions")]
  disp -->|"INSERT"| db
  push <-->|"абонаменти"| db
  disp -->|"notification:new<br>Redis pub/sub"| ws["WS сървър (Socket.IO)<br>известие на живо"]
  push -->|"HTTPS POST"| svc["Push услуги<br>Apple · Google FCM · Microsoft WNS · Mozilla"]
  svc -.-> sw["Service worker (sw.js)<br>iOS 16.4+ · Android · Windows · macOS<br>Declarative Web Push: Safari 18.4+"]
```

## Фигура 13. UML диаграма на абониране на устройство

Изходен файл: [`src/13-push-subscribe.mmd`](src/13-push-subscribe.mmd) · [PNG](out/13-push-subscribe.png) · [SVG](out/13-push-subscribe.svg) · [HTML](out/13-push-subscribe.html)

```mermaid
%% Фигура 13 – Абониране на устройство
sequenceDiagram
  actor U as Потребител
  participant B as Браузър · sw.js
  participant P as Push услуга (Apple / Google / Microsoft)
  participant K as KAIROS (tRPC)
  participant DB as PostgreSQL
  U->>B: Известия → Това устройство → Включи
  B->>U: заявка за разрешение
  U->>B: Разрешавам
  B->>P: pushManager.subscribe(VAPID ключ)
  P-->>B: endpoint + p256dh, auth
  B->>K: pushSubscribe(endpoint, p256dh, auth)
  K->>DB: UPSERT push_subscriptions
  alt сменен адрес
    P->>B: pushsubscriptionchange
    B->>P: pushManager.subscribe()
    B->>K: pushSubscribe(нов)
  else всяко отваряне на приложението
    B->>K: pushSubscribe(текущия абонамент)
  else изход от акаунта или „Изключи“
    B->>P: unsubscribe()
    B->>K: pushUnsubscribe(endpoint)
    K->>DB: DELETE абонамента
  end
```

## Фигура 14. Последователност на двуфакторния вход с код или одобрение през линк

Изходен файл: [`src/14-two-factor-sequence.mmd`](src/14-two-factor-sequence.mmd) · [PNG](out/14-two-factor-sequence.png) · [SVG](out/14-two-factor-sequence.svg) · [HTML](out/14-two-factor-sequence.html)

```mermaid
%% Фигура 14 – Двуфакторен вход с код или одобрение през линк
sequenceDiagram
  autonumber
  participant B as Браузър
  participant S as Сървър (NextAuth.js)
  participant DB as two_factor_challenge
  participant E as Имейл
  participant A as Страница за одобрение
  B->>S: имейл и парола (credentials)
  S->>S: Argon2id и ограничител на опитите
  S->>DB: анулира старите, записва SHA-256 на тайна, код и токен (10 минути)
  S->>E: осемцифрен код и линк
  S-->>B: отказ и тайна, без сесия
  alt въвеждане на кода
    B->>S: тайна и код (two-factor)
    S->>DB: сравнява хешовете (timingSafeEqual), при 5 грешни – анулира
  else одобрение през линк
    E->>A: отваря линка
    A->>S: GET – само показва заявката
    A->>S: „Одобри“ (POST)
    S->>DB: approvedAt = сега
    Note over A,S: „Откажи“ записва deniedAt и анулира предизвикателството
    B->>S: twoFactorStatus (на всеки 3 секунди)
    S-->>B: approved
    B->>S: тайна без код (two-factor)
  end
  S->>DB: еднократно изразходване (consumedAt)
  S-->>B: JWT сесия
```

## Фигура 15. Състояния на предизвикателството за двуфакторен вход

Изходен файл: [`src/15-two-factor-states.mmd`](src/15-two-factor-states.mmd) · [PNG](out/15-two-factor-states.png) · [SVG](out/15-two-factor-states.svg) · [HTML](out/15-two-factor-states.html)

```mermaid
%% Фигура 15 – Състояния на предизвикателството за двуфакторен вход
stateDiagram-v2
  direction TB
  [*] --> pending: вярна парола
  pending --> approved: „Одобри“ от линка
  pending --> consumed: тайна и верен код
  approved --> consumed: тайна без код
  pending --> denied: „Откажи“ от линка
  pending --> expired: 10 минути
  approved --> expired: 10 минути
  pending --> invalid: 5 грешни кода или нов вход
  approved --> invalid: нов вход
  consumed --> [*]: JWT сесия
  state "Чака потвърждение (pending)" as pending
  state "Одобрено (approved)" as approved
  state "Изразходвано (издадена сесия)" as consumed
  state "Отказано (denied)" as denied
  state "Изтекло (expired)" as expired
  state "Анулирано (invalid)" as invalid
```

## Фигура 16. Заключване и отключване на бележка с парола

Изходен файл: [`src/16-note-lock.mmd`](src/16-note-lock.mmd) · [PNG](out/16-note-lock.png) · [SVG](out/16-note-lock.svg) · [HTML](out/16-note-lock.html)

```mermaid
%% Фигура 16 – Заключване и отключване на бележка
flowchart TB
  subgraph LOCK["Заключване"]
    direction LR
    l1["Парола"] --> l2["Хеш на паролата<br>Argon2id"]
    l1 --> l3["Ключ от паролата и случайна сол<br>PBKDF2-HMAC-SHA512, 210 000"] --> l4["Криптиране<br>AES-256-GCM, префикс v2:"]
  end
  db[("База данни · хеш · сол · криптиран текст")]
  subgraph UNLOCK["Отключване"]
    direction LR
    u1["Проверка на паролата спрямо хеша<br>с ограничение на опитите"] --> u2["Ключ отново с PBKDF2<br>и декриптиране"] --> u3["Съдържанието се показва"]
  end
  LOCK --> db --> UNLOCK
```

## Фигура 17. Релационен модел (ER диаграма) на базата данни на KAIROS

Изходен файл: [`src/17-er.mmd`](src/17-er.mmd) · [PNG](out/17-er.png) · [SVG](out/17-er.svg) · [HTML](out/17-er.html)

```mermaid
%% Фигура 17 – Релационен модел (основни таблици). Генериран от src/server/db/schemas; проверява се спрямо схемата.
erDiagram
  user {
    varchar id PK
    varchar name
    varchar email
    enum language
  }
  organizations {
    integer id PK
    varchar created_by_id FK
    varchar name
    varchar access_code
    enum plan
  }
  organization_members {
    integer id PK
    integer organization_id FK
    varchar user_id FK
    enum role
  }
  organization_roles {
    integer id PK
    integer organization_id FK
    varchar name
  }
  projects {
    integer id PK
    varchar createdById FK
    integer organization_id FK
    varchar title
    enum status
  }
  project_collaborators {
    integer project_id FK
    varchar collaboratorId FK
    enum permission
  }
  tasks {
    integer id PK
    integer project_id FK
    integer parent_task_id FK
    varchar assignedToId FK
    varchar completed_by_id FK
    varchar createdById FK
    varchar last_edited_by_id FK
    varchar title
    enum status
    enum priority
    timestamp due_date
  }
  task_comments {
    integer id PK
    integer task_id FK
    varchar createdById FK
    text content
  }
  task_dependencies {
    integer id PK
    integer blocked_task_id FK
    integer blocking_task_id FK
    varchar createdById FK
  }
  notebooks {
    integer id PK
    varchar createdById FK
    varchar name
  }
  sticky_notes {
    integer id PK
    varchar createdById FK
    integer notebook_id FK
    varchar title
    enum share_status
  }
  event {
    integer id PK
    varchar createdById FK
    varchar title
    timestamp event_date
  }
  event_rsvp {
    integer id PK
    integer event_id FK
    varchar user_id FK
    enum status
  }
  notifications {
    integer id PK
    varchar user_id FK
    enum type
    boolean read
  }
  ai_conversations {
    varchar id PK
    varchar user_id FK
    integer project_id FK
    varchar title
  }
  ai_messages {
    integer id PK
    varchar conversation_id FK
    enum role
    varchar agent_id
  }
  documents {
    integer id PK
    varchar user_id FK
    integer project_id FK
    varchar filename
    varchar status
  }
  document_chunks {
    integer id PK
    integer document_id FK
    varchar user_id FK
    integer page
  }
  agent_task_planner_drafts {
    varchar id PK
    varchar user_id FK
    integer project_id FK
    integer org_id FK
    enum status
    varchar plan_hash
  }
  agent_task_planner_applies {
    integer id PK
    varchar draft_id FK
    varchar user_id FK
    integer project_id FK
    text before_json
    text result_json
  }
  agent_task_planner_drafts ||--o{ agent_task_planner_applies : "draft_id"
  ai_conversations ||--o{ ai_messages : "conversation_id"
  documents ||--o{ document_chunks : "document_id"
  event ||--o{ event_rsvp : "event_id"
  notebooks ||--o{ sticky_notes : "notebook_id"
  organizations ||--o{ agent_task_planner_drafts : "org_id"
  organizations ||--o{ organization_members : "organization_id"
  organizations ||--o{ organization_roles : "organization_id"
  organizations ||--o{ projects : "organization_id"
  projects ||--o{ agent_task_planner_applies : "project_id"
  projects ||--o{ agent_task_planner_drafts : "project_id"
  projects ||--o{ ai_conversations : "project_id"
  projects ||--o{ documents : "project_id"
  projects ||--o{ project_collaborators : "project_id"
  projects ||--o{ tasks : "project_id"
  tasks ||--o{ task_comments : "task_id"
  tasks ||--o{ task_dependencies : "blocked_task_id"
  tasks ||--o{ task_dependencies : "blocking_task_id"
  tasks ||--o{ tasks : "parent_task_id"
  user ||--o{ agent_task_planner_applies : "user_id"
  user ||--o{ agent_task_planner_drafts : "user_id"
  user ||--o{ ai_conversations : "user_id"
  user ||--o{ document_chunks : "user_id"
  user ||--o{ documents : "user_id"
  user ||--o{ event : "createdById"
  user ||--o{ event_rsvp : "user_id"
  user ||--o{ notebooks : "createdById"
  user ||--o{ notifications : "user_id"
  user ||--o{ organization_members : "user_id"
  user ||--o{ organizations : "created_by_id"
  user ||--o{ project_collaborators : "collaboratorId"
  user ||--o{ projects : "createdById"
  user ||--o{ sticky_notes : "createdById"
  user ||--o{ task_comments : "createdById"
  user ||--o{ task_dependencies : "createdById"
  user ||--o{ tasks : "assignedToId"
  user ||--o{ tasks : "completed_by_id"
  user ||--o{ tasks : "createdById"
  user ||--o{ tasks : "last_edited_by_id"
```

## Фигура 20. Резултати от оценката на маршрутизацията

Изходен файл: [`src/20-routing-results.mmd`](src/20-routing-results.mmd) · [PNG](out/20-routing-results.png) · [SVG](out/20-routing-results.svg) · [HTML](out/20-routing-results.html)

```mermaid
---
config:
  xyChart:
    width: 900
    height: 520
  themeVariables:
    xyChart:
      plotColorPalette: "#9aa4b4, #2c4f8f"
---
%% Фигура 20 – Проверка без връзка с модела: точност по вид решение (55 случая: 27 / 25 / 3)
xychart-beta
  title "Без връзка с модела · 55 случая"
  x-axis ["Отговор (27)", "Делегиране (25)", "Уточнение (3)"]
  y-axis "Точност, %" 0 --> 100
  bar [100, 100, 100]
```

## Фигура 21. Сравнение на резултатите без връзка и с реален модел

Изходен файл: [`src/21-offline-vs-model.mmd`](src/21-offline-vs-model.mmd) · [PNG](out/21-offline-vs-model.png) · [SVG](out/21-offline-vs-model.svg) · [HTML](out/21-offline-vs-model.html)

```mermaid
---
config:
  xyChart:
    width: 1000
    height: 540
  themeVariables:
    xyChart:
      plotColorPalette: "#9aa4b4, #2c4f8f"
---
%% Фигура 21 – Без връзка (сиво) спрямо реален модел gpt-oss-20b (синьо), 25.09.2026
xychart-beta
  title "55 случая · сиво: без връзка (100 %) · синьо: gpt-oss-20b"
  x-axis ["Схема, 1-ви отговор", "Схема, след поправка", "Маршрутизация"]
  y-axis "%" 0 --> 100
  bar [100, 100, 100]
  bar [96.4, 98.2, 72.7]
```
