// =============================================================================
// Memory router for components that read route params or navigate
// =============================================================================
//
//   decorators: [withMemoryRouter('/server/story-server/workspace/session/sess-1')]
//
// The route tree mirrors the app's URL shape so `useParams({ from:
// '/server/$serverId' })`, `useRouterState` and `<Link>` work. Every leaf
// renders the story. Navigation stays inside the memory history and shows up
// in the Actions panel.

import { createContext, useContext, useMemo, type ComponentType, type ReactNode } from 'react';
import { action } from 'storybook/actions';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';

/** The rendered story element; every leaf route shows it. */
const StoryContext = createContext<ReactNode>(null);

function StoryOutlet() {
  return useContext(StoryContext);
}

const rootRoute = createRootRoute({ component: Outlet });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: StoryOutlet });
const addServerRoute = createRoute({ getParentRoute: () => rootRoute, path: '/add-server', component: StoryOutlet });
const pairRoute = createRoute({ getParentRoute: () => rootRoute, path: '/pair', component: StoryOutlet });
const serverRoute = createRoute({ getParentRoute: () => rootRoute, path: '/server/$serverId', component: Outlet });
const serverIndexRoute = createRoute({ getParentRoute: () => serverRoute, path: '/', component: StoryOutlet });
const workspaceRoute = createRoute({ getParentRoute: () => serverRoute, path: 'workspace', component: Outlet });
const workspaceIndexRoute = createRoute({ getParentRoute: () => workspaceRoute, path: '/', component: StoryOutlet });
const workspaceSessionRoute = createRoute({ getParentRoute: () => workspaceRoute, path: 'session/$sessionId', component: StoryOutlet });
const overviewRoute = createRoute({ getParentRoute: () => serverRoute, path: 'overview', component: Outlet });
const overviewIndexRoute = createRoute({ getParentRoute: () => overviewRoute, path: '/', component: StoryOutlet });
const overviewSessionRoute = createRoute({ getParentRoute: () => overviewRoute, path: 'session/$sessionId', component: StoryOutlet });
const agentRoute = createRoute({ getParentRoute: () => serverRoute, path: 'agent/$agentId', component: Outlet });
const agentIndexRoute = createRoute({ getParentRoute: () => agentRoute, path: '/', component: StoryOutlet });
const agentSessionRoute = createRoute({ getParentRoute: () => agentRoute, path: 'session/$sessionId', component: StoryOutlet });
const catchAllRoute = createRoute({ getParentRoute: () => rootRoute, path: '$', component: StoryOutlet });

const routeTree = rootRoute.addChildren([
  indexRoute,
  addServerRoute,
  pairRoute,
  serverRoute.addChildren([
    serverIndexRoute,
    workspaceRoute.addChildren([workspaceIndexRoute, workspaceSessionRoute]),
    overviewRoute.addChildren([overviewIndexRoute, overviewSessionRoute]),
    agentRoute.addChildren([agentIndexRoute, agentSessionRoute]),
  ]),
  catchAllRoute,
]);

export const STORY_ROUTES = {
  home: '/',
  workspace: '/server/story-server/workspace',
  workspaceSession: '/server/story-server/workspace/session/story-session',
  overview: '/server/story-server/overview',
  overviewSession: '/server/story-server/overview/session/story-session',
} as const;

export function withMemoryRouter(initialPath: string = STORY_ROUTES.workspace) {
  return function MemoryRouterDecorator(Story: ComponentType) {
    const router = useMemo(() => {
      const history = createMemoryHistory({ initialEntries: [initialPath] });
      history.subscribe(() => action('router.navigate')(history.location.href));
      return createRouter({ routeTree, history, defaultPendingMinMs: 0 });
    }, []);
    return (
      <StoryContext.Provider value={<Story />}>
        <RouterProvider router={router} />
      </StoryContext.Provider>
    );
  };
}
