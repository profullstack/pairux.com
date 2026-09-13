export interface UseCase {
  slug: string;
  title: string;
  audience: string;
  description: string;
  scenario: string;
  outcome: string;
  steps: { title: string; body: string }[];
  planned?: boolean;
}

export const aiNotesContact =
  'mailto:hello@pairux.com?subject=AI%20note%20taker%20for%20premium%20plans';

export const useCases: UseCase[] = [
  {
    slug: 'agentic-pair-programming',
    title: 'Agentic pair programming',
    audience: 'Developers & teammates',
    description:
      'Work with a teammate in one live coding-agent session. Share the terminal through moshcode and review the screen together in PairUX.',
    scenario:
      'You want a teammate to help guide an agent while it works in your development environment.',
    outcome: 'A shared understanding of what the agent changed and what to do next.',
    steps: [
      {
        title: 'Start a shared terminal',
        body: 'Open your live moshcode session and share it with your team.',
      },
      {
        title: 'Bring the app into view',
        body: 'Share your editor or app preview through PairUX.',
      },
      {
        title: 'Work through the next step',
        body: 'Review the result together and decide what to ask the agent next.',
      },
    ],
  },
  {
    slug: 'ai-code-review',
    title: 'Review AI-generated code',
    audience: 'Developers & reviewers',
    description:
      'Walk through the diff, tests, and running app together before an agent’s changes become a merged pull request.',
    scenario:
      'An agent has produced a large change. A reviewer needs to understand its behavior, not just read a summary of the patch.',
    outcome: 'A reviewed change with clear fixes, follow-up tests, and a shared merge decision.',
    steps: [
      {
        title: 'Open the evidence',
        body: 'Share your editor with the diff, task requirements, and test output visible. Explain what you asked the agent to change.',
      },
      {
        title: 'Try the behavior together',
        body: 'Run the app and exercise the important paths. Approve remote control if the reviewer wants to try an edge case directly.',
      },
      {
        title: 'Turn findings into the next edit',
        body: 'Agree on corrections and ask your coding agent to make them. Review the new diff and rerun the relevant checks before merging.',
      },
    ],
  },
  {
    slug: 'debugging-with-agents',
    title: 'Get a stuck agent moving',
    audience: 'Developers & debugging partners',
    description:
      'Bring a second person into a failing test or a loop of unsuccessful fixes. Inspect the evidence and choose the next experiment together.',
    scenario:
      'Your coding agent keeps changing code without fixing the failure. A teammate can help spot a missing assumption or an environment problem.',
    outcome: 'A reproducible failure and a focused next step for the agent.',
    steps: [
      {
        title: 'Show the failure as it happens',
        body: 'Share the terminal and reproduce the issue. Walk your teammate through the error, the recent changes, and what has already been tried.',
      },
      {
        title: 'Test one explanation',
        body: 'Inspect logs, configuration, and the running app together. Grant remote control when your teammate needs to explore the same environment.',
      },
      {
        title: 'Give the agent better direction',
        body: 'Write down the reproduction steps and the evidence behind your chosen fix. Ask the agent for a focused change, then check the original failure again.',
      },
    ],
  },
  {
    slug: 'contractor-onboarding',
    title: 'Onboard contractors in context',
    audience: 'Team leads & new teammates',
    description:
      'Let a new teammate watch a real task, learn your codebase and agent workflow, then participate when they are ready.',
    scenario:
      'A contractor is joining your project and needs to understand how you use agents, review changes, and decide when work is ready to ship.',
    outcome: 'A teammate who understands your workflow and can take on the next task with context.',
    steps: [
      {
        title: 'Start with a real task',
        body: 'Share your development screen and explain the project, the task, and how you brief your coding agent. Let the contractor observe the first pass.',
      },
      {
        title: 'Explain the decisions',
        body: 'Walk through the agent’s output, the tests, and the running app. Show where you accept a suggestion and where you ask for another approach.',
      },
      {
        title: 'Let them take a turn',
        body: 'Approve PairUX remote control for a guided edit. If you also use moshcode, give them writer access to a shared team session when they are ready to send terminal input.',
      },
    ],
  },
  {
    slug: 'product-design-review',
    title: 'Review the app with product and design',
    audience: 'Builders, designers & product teams',
    description:
      'Show the app an agent is building to the people who will judge the result. Try the flow together and turn feedback into specific changes.',
    scenario:
      'A working prototype is ready, but the interaction, wording, or layout needs feedback from someone outside the code.',
    outcome: 'Concrete acceptance criteria and an agreed list of changes to the working app.',
    steps: [
      {
        title: 'Share the working experience',
        body: 'Open the app preview and share that window in PairUX. Walk through the task a real user should be able to complete.',
      },
      {
        title: 'Let the reviewer explore',
        body: 'Invite feedback as you navigate, or approve remote control so the reviewer can try the flow on your machine.',
      },
      {
        title: 'Close the feedback loop',
        body: 'Turn observations into specific requests for your coding agent. Show the updated app in the same session and agree on what is ready.',
      },
    ],
  },
  {
    slug: 'remote-support',
    title: 'Unblock someone’s AI workflow',
    audience: 'Support teams & technical leads',
    description:
      'Help a teammate configure a tool, understand an error, or recover a broken local workflow while you both see the same screen.',
    scenario:
      'An agent or development tool works on one machine but fails on another. Screenshots and copied error messages are missing the context.',
    outcome: 'A working setup and a person who understands how the issue was resolved.',
    steps: [
      {
        title: 'Have them show the problem',
        body: 'The person with the issue hosts a PairUX session and shares the relevant tool window. Join from your browser and watch them reproduce the failure.',
      },
      {
        title: 'Guide the fix in their environment',
        body: 'Explain the next check and let them perform it. Request remote control when hands-on help is useful; the host decides whether to approve it.',
      },
      {
        title: 'Verify the whole workflow',
        body: 'Ask them to run the original task again. Leave them with the steps that fixed the issue so they can recognize it next time.',
      },
    ],
  },
  {
    slug: 'live-ai-workshops',
    title: 'Teach a live AI coding workshop',
    audience: 'Educators, communities & teams',
    description:
      'Show an audience how you brief an agent, inspect its work, and handle mistakes while building something real.',
    scenario:
      'Your team wants to learn an agent workflow by watching the decisions and corrections that a polished demo usually leaves out.',
    outcome: 'An audience that has seen the full path from a task brief to a checked result.',
    steps: [
      {
        title: 'Set up a focused demonstration',
        body: 'Choose a small task and share the terminal, editor, or app you will use. Pick a PairUX plan that fits your room’s listener capacity.',
      },
      {
        title: 'Show the reasoning behind the prompts',
        body: 'Explain the context you give the agent and why. Pause at key moments to inspect the diff, run tests, and discuss an unexpected result.',
      },
      {
        title: 'Practice reviewing the result',
        body: 'Have the group suggest edge cases and follow-up changes. Run those checks in view so participants see how you decide whether the work is ready.',
      },
    ],
  },
  {
    slug: 'ai-note-taker',
    title: 'AI note taker',
    audience: 'Premium plans · Planned',
    description:
      'Planned for premium plans: turn a working session into draft notes, decisions, and action items so the next person can pick up with context.',
    scenario:
      'Your team wants to stay focused on the shared work and leave with useful notes for the next session.',
    outcome: 'A reviewed recap of the work, the decisions, and the next steps.',
    planned: true,
    steps: [
      {
        title: 'Choose a session for notes',
        body: 'The planned workflow starts with the host enabling note taking and letting participants know that the session will be used to prepare notes.',
      },
      {
        title: 'Review a draft recap',
        body: 'The proposed note taker would organize the discussion into a summary, decisions, and action items for a person to check and edit.',
      },
      {
        title: 'Carry context into the next task',
        body: 'Use the reviewed notes to brief a teammate or prepare the next request for your agent. Specific delivery and plan details will be agreed with interested customers.',
      },
    ],
  },
];
