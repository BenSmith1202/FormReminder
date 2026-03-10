import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import CreateRequest from './pages/CreateRequest';
import ServerTime from './pages/ServerTime';
import Groups from './pages/Groups';
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
    primary: {
      main: '#1976d2', // Blue primary color
    },
    background: {
      default: '#f5f5f5', // Light gray background
    },
  },
  typography: {
    h4: {
      fontWeight: 600,
    },
  },
});

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline /> {/* Normalizes CSS */}
      <BrowserRouter>
        <Routes>
          {/* Public routes (no Layout) */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/reset" element={<Reset />} />
          <Route path="/groups/join/:token" element={<JoinGroup />} />
          
          {/* Protected routes (with Layout) */}
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/requests/new" element={<CreateRequest />} />
            <Route path="/requests/:requestId" element={<ViewRequest />} />
            <Route path="/request/:requestId" element={<ViewRequest />} />
            <Route path="/requests/:requestId/edit" element={<EditRequest />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/time" element={<ServerTime />} />
            <Route path="/groups" element={<Groups />} />
            <Route path="/groups/new" element={<CreateGroup />} />
            <Route path="/groups/:groupId" element={<ViewGroup />} />
            <Route path="/groups/:groupId/edit" element={<EditGroup />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;