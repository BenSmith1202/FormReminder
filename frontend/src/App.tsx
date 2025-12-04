import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import CreateRequest from './pages/CreateRequest';
import ServerTime from './pages/ServerTime';
import Groups from './pages/Groups'; // Import the new page

// 1. Create a custom theme (matches the Blue/White vibe of your report)
const theme = createTheme({
  palette: {
    primary: {
      main: '#1976d2', // Standard Blue
    },
    background: {
      default: '#f5f5f5', // Light Gray background
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
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/new" element={<CreateRequest />} />
            <Route path="/time" element={<ServerTime />} />
            <Route path="/groups" element={<Groups />} /> {/* New Route */}
          </Routes>
        </Layout>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;