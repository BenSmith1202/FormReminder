import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';

// Components & Pages
import Layout from './components/Layout';
import Dashboard, { dashboardLoader } from './pages/Dashboard';
import Groups, { groupsLoader } from './pages/Groups';
import CreateRequest from './pages/CreateRequest';
import ServerTime from './pages/ServerTime';
import CreateGroup from './pages/CreateGroup';
import JoinGroup from './pages/JoinGroup';
import ViewGroup from './pages/ViewGroup';
import Login from './pages/Login';
import Register from './pages/Register';
import Reset from './pages/Reset';
import Settings from './pages/Settings';
import ViewRequest from './pages/ViewRequest';
import Analytics from './pages/Analytics';
import EditRequest from './pages/EditRequest';
import EditGroup from './pages/EditGroup';

const theme = createTheme({
  palette: {
    primary: { main: '#1976d2' },
    background: { default: '#f5f5f5' },
  },
  typography: {
    h4: { fontWeight: 600 },
  },
  components: {
    MuiTypography: {
      defaultProps: {
        variantMapping: {
          h1: 'h1',
          h2: 'h2',
          h3: 'h3',
          h4: 'h4',
          h5: 'h5',
          h6: 'h6',
          subtitle1: 'p',
          subtitle2: 'p',
          body1: 'p',
          body2: 'p',
          inherit: 'p',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        outlinedPrimary: {
          color: '#1565c0',
          borderColor: '#1565c0',
          '&:hover': {
            borderColor: '#0d47a1',
            backgroundColor: 'rgba(21, 101, 192, 0.04)',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        colorWarning: {
          backgroundColor: '#fff3e0',
          color: '#bf360c',
          '& .MuiChip-icon': { color: '#bf360c' },
          '&.MuiChip-outlined': {
            backgroundColor: 'transparent',
            color: '#bf360c',
            borderColor: '#bf360c',
          },
        },
      },
    },
  },
});

const router = createBrowserRouter([
  // Public routes
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  { path: '/reset', element: <Reset /> },
  { path: '/groups/join/:token', element: <JoinGroup /> },
  
  // Protected routes
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Dashboard />, loader: dashboardLoader }, // Added loader
      { path: 'requests/new', element: <CreateRequest /> },
      { path: 'requests/:requestId', element: <ViewRequest /> },
      { path: 'request/:requestId', element: <ViewRequest /> },
      { path: 'requests/:requestId/edit', element: <EditRequest /> },
      { path: 'analytics', element: <Analytics /> },
      { path: 'time', element: <ServerTime /> },
      { path: 'groups', element: <Groups />, loader: groupsLoader }, // Added loader
      { path: 'groups/new', element: <CreateGroup /> },
      { path: 'groups/:groupId', element: <ViewGroup /> },
      { path: 'groups/:groupId/edit', element: <EditGroup /> },
      { path: 'settings', element: <Settings /> },
    ]
  }
]);

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}

export default App;