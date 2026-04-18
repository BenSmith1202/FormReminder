import { Snackbar, Alert } from '@mui/material';

export default function ErrorSnackbar({
  error,
  onClose,
  severity = 'error',
  action,
}: {
  error: string | null;
  onClose: () => void;
  severity?: 'error' | 'warning' | 'info' | 'success';
  action?: React.ReactNode;
}) {
  return (
    <Snackbar
      open={!!error}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      onClose={(_, reason) => { if (reason !== 'clickaway') onClose(); }}
      sx={{ top: { xs: 70, sm: 78 }, zIndex: 1400 }}
    >
      <Alert
        severity={severity}
        onClose={onClose}
        action={action}
        variant="filled"
        sx={{ width: '100%', minWidth: 320, maxWidth: 700, boxShadow: 3 }}
      >
        {error}
      </Alert>
    </Snackbar>
  );
}
