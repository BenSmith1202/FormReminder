import { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Radio,
  RadioGroup,
  FormControlLabel,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Chip,
  Divider,
  Container,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import DescriptionIcon from '@mui/icons-material/Description';
import GroupIcon from '@mui/icons-material/Group';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';

const API_URL = 'http://localhost:5000';

interface Group {
  id: string;
  name: string;
  member_count: number;
}

// Shared section header component
function SectionHeader({
  icon,
  title,
  description,
  iconBg = 'primary.50',
  iconColor = 'primary.main',
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  iconBg?: string;
  iconColor?: string;
}) {
  return (
    <>
      <Box display="flex" alignItems="center" gap={2} mb={3}>
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: 2,
            bgcolor: iconBg,
            color: iconColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Box>
          <Typography variant="subtitle1" fontWeight="bold">
            {title}
          </Typography>
          {description && (
            <Typography variant="body2" color="text.secondary">
              {description}
            </Typography>
          )}
        </Box>
      </Box>
      <Divider sx={{ mb: 3 }} />
    </>
  );
}

export default function CreateRequest() {
  const navigate = useNavigate();

  // Form state
  const [requestTitle, setRequestTitle] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [groupId, setGroupId] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [dueDate, setDueDate] = useState<Date | null>(null);

  // Schedule state
  const [reminderSchedule, setReminderSchedule] = useState('normal');
  const [firstReminderTiming, setFirstReminderTiming] = useState('immediate');
  const [scheduledDate, setScheduledDate] = useState<Date | null>(null);
  const [scheduledTime, setScheduledTime] = useState<Date | null>(null);

  // Custom schedule state
  const [customScheduleOpen, setCustomScheduleOpen] = useState(false);
  const [customDays, setCustomDays] = useState<number[]>([]);
  const [newDayInput, setNewDayInput] = useState('');
  const [customScheduleError, setCustomScheduleError] = useState<string | null>(null);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsGoogleReconnect, setNeedsGoogleReconnect] = useState(false);

  useEffect(() => {
    loadGroups();
  }, []);

  const loadGroups = async () => {
    try {
      const response = await fetch(`${API_URL}/api/groups`, { credentials: 'include' });
      const data = await response.json();
      setGroups(data.groups || []);
    } catch {
      console.error('Failed to load groups');
    }
  };

  const handleAddCustomDay = () => {
    const day = parseInt(newDayInput);
    if (isNaN(day) || day < 1 || day > 365) {
      setCustomScheduleError('Please enter a valid number between 1 and 365');
      return;
    }
    if (customDays.includes(day)) {
      setCustomScheduleError('This day is already in your schedule');
      return;
    }
    if (customDays.length >= 30) {
      setCustomScheduleError('Maximum 30 reminder days allowed');
      return;
    }
    setCustomDays([...customDays, day]);
    setNewDayInput('');
    setCustomScheduleError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formUrl) { setError('Please enter a form URL'); return; }
    if (!groupId) { setError('Please select a group'); return; }
    if (!dueDate) { setError('Please select a due date'); return; }
    if (firstReminderTiming === 'scheduled' && (!scheduledDate || !scheduledTime)) {
      setError('Please select both a date and time for the scheduled reminder');
      return;
    }

    setLoading(true);
    try {
      const requestBody: any = {
        form_url: formUrl,
        group_id: groupId,
        title: requestTitle || undefined,
        due_date: dueDate.toISOString(),
        reminder_schedule: reminderSchedule,
        first_reminder_timing: firstReminderTiming,
      };

      if (reminderSchedule === 'custom') {
        if (customDays.length === 0) {
          setError('Please create a custom schedule with at least one day');
          setLoading(false);
          return;
        }
        requestBody.custom_days = customDays;
      }

      if (firstReminderTiming === 'scheduled' && scheduledDate && scheduledTime) {
        requestBody.scheduled_date = scheduledDate.toISOString();
        requestBody.scheduled_time = scheduledTime.toISOString();
      }

      const response = await fetch(`${API_URL}/api/form-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(requestBody),
      });
      const data = await response.json();

      if (!response.ok) {
        const needsReconnect =
          data.action_required === 'reconnect_google' ||
          (response.status === 403 && data.error?.toLowerCase().includes('google'));
        if (needsReconnect) setNeedsGoogleReconnect(true);
        throw new Error(data.message || data.error || 'Failed to create form request');
      }

      setNeedsGoogleReconnect(false);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Failed to create form request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Container maxWidth="md" sx={{ py: 4 }} className="page-fade-in">
        {/* Page title */}
        <Box mb={4}>
          <Typography variant="h4" component="h1" fontWeight="bold" gutterBottom>
            New Form Request
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Set up a form, assign recipients, and configure your reminder schedule.
          </Typography>
        </Box>

        {error && (
          <Alert
            severity="error"
            sx={{ mb: 3 }}
            onClose={() => { setError(null); setNeedsGoogleReconnect(false); }}
            action={
              needsGoogleReconnect ? (
                <Button
                  color="inherit"
                  size="small"
                  onClick={async () => {
                    try {
                      const res = await fetch(`${API_URL}/login/google`, { credentials: 'include' });
                      const data = await res.json();
                      if (data.authorization_url) {
                        window.location.href = data.authorization_url;
                      } else {
                        setError(data.error || 'Could not start Google connect');
                      }
                    } catch {
                      setError('Could not start Google connect');
                    }
                  }}
                >
                  Connect Google
                </Button>
              ) : undefined
            }
          >
            {error}
          </Alert>
        )}

        <Box component="form" onSubmit={handleSubmit} display="flex" flexDirection="column" gap={3}>

          {/* ── Section 1: General ── */}
          <Paper
            elevation={0}
            sx={{ p: { xs: 3, sm: 4 }, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}
          >
            <SectionHeader
              icon={<DescriptionIcon sx={{ fontSize: 22 }} />}
              title="General Information"
              description="Name this request and paste in the form link."
            />
            <Box display="flex" flexDirection="column" gap={2.5}>
              <TextField
                label="Request Title"
                fullWidth
                size="small"
                placeholder="e.g. Q1 Survey — Team Alpha"
                value={requestTitle}
                onChange={(e) => setRequestTitle(e.target.value)}
              />
              <Box>
                <TextField
                  label="Form URL"
                  fullWidth
                  size="small"
                  required
                  placeholder="https://docs.google.com/forms/d/…/edit"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                />
                <Typography variant="caption" color="text.secondary" display="block" mt={0.75} ml={0.25}>
                  Use the form's <strong>edit link</strong> (URL contains <code>/edit</code>). The share/view link won't work for response syncing.
                </Typography>
              </Box>
            </Box>
          </Paper>

          {/* ── Section 2: Recipients ── */}
          <Paper
            elevation={0}
            sx={{ p: { xs: 3, sm: 4 }, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}
          >
            <SectionHeader
              icon={<GroupIcon sx={{ fontSize: 22 }} />}
              title="Recipients"
              description="Choose which group should receive this form request."
              iconBg="success.50"
              iconColor="success.main"
            />
            <Box display="flex" gap={2} flexWrap="wrap" alignItems="center">
              <FormControl size="small" sx={{ flex: 1, minWidth: 200 }} required>
                <InputLabel>Select Group</InputLabel>
                <Select
                  value={groupId}
                  label="Select Group"
                  onChange={(e) => setGroupId(e.target.value)}
                >
                  {groups.length === 0 ? (
                    <MenuItem disabled>No groups available</MenuItem>
                  ) : (
                    groups.map((group) => (
                      <MenuItem key={group.id} value={group.id}>
                        {group.name}
                        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                          ({group.member_count} members)
                        </Typography>
                      </MenuItem>
                    ))
                  )}
                </Select>
              </FormControl>
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => navigate('/groups/new')}
                sx={{ flexShrink: 0, height: 40 }}
              >
                New Group
              </Button>
            </Box>
          </Paper>

          {/* ── Section 3: Schedule & Deadline ── */}
          <Paper
            elevation={0}
            sx={{ p: { xs: 3, sm: 4 }, border: '1px solid', borderColor: 'divider', borderRadius: 3 }}
          >
            <SectionHeader
              icon={<CalendarTodayIcon sx={{ fontSize: 22 }} />}
              title="Schedule & Deadline"
              description="Set a due date and how often reminders go out."
              iconBg="info.50"
              iconColor="info.main"
            />

            {/* Due date */}
            <Box mb={3}>
              <Typography variant="body2" fontWeight="medium" gutterBottom>
                Due Date <Typography component="span" color="error">*</Typography>
              </Typography>
              <DatePicker
                value={dueDate}
                onChange={(v) => setDueDate(v)}
                slotProps={{
                  textField: { size: 'small', fullWidth: true, required: true },
                }}
              />
            </Box>

            <Divider sx={{ mb: 3 }} />

            {/* Reminder frequency */}
            <Box mb={3}>
              <Typography variant="body2" fontWeight="medium" gutterBottom>
                Reminder Frequency
              </Typography>
              <RadioGroup
                value={reminderSchedule}
                onChange={(e) => {
                  setReminderSchedule(e.target.value);
                  if (e.target.value !== 'custom') setCustomDays([]);
                }}
              >
                <FormControlLabel
                  value="gentle"
                  control={<Radio size="small" />}
                  label={<Typography variant="body2">Gentle — 3 and 1 days before</Typography>}
                />
                <FormControlLabel
                  value="normal"
                  control={<Radio size="small" />}
                  label={<Typography variant="body2">Normal — 5, 3, and 1 days before</Typography>}
                />
                <FormControlLabel
                  value="frequent"
                  control={<Radio size="small" />}
                  label={<Typography variant="body2">Frequent — daily for the last two weeks</Typography>}
                />
                {customDays.length > 0 && (
                  <FormControlLabel
                    value="custom"
                    control={<Radio size="small" />}
                    label={
                      <Typography variant="body2">
                        Custom —{' '}
                        {customDays
                          .sort((a, b) => b - a)
                          .map((d) => `${d} day${d !== 1 ? 's' : ''}`)
                          .join(', ')}{' '}
                        before
                      </Typography>
                    }
                  />
                )}
              </RadioGroup>

              {/* Custom chips */}
              {reminderSchedule === 'custom' && customDays.length > 0 && (
                <Box display="flex" flexWrap="wrap" gap={1} mt={1.5} ml={3.5}>
                  {customDays
                    .sort((a, b) => b - a)
                    .map((day) => (
                      <Chip
                        key={day}
                        label={`${day} day${day !== 1 ? 's' : ''} before`}
                        size="small"
                        onDelete={() => {
                          const updated = customDays.filter((d) => d !== day);
                          setCustomDays(updated);
                          if (updated.length === 0) setReminderSchedule('normal');
                        }}
                      />
                    ))}
                </Box>
              )}

              <Button
                variant="text"
                size="small"
                sx={{ mt: 1.5, textTransform: 'none', fontWeight: 'medium' }}
                onClick={() => setCustomScheduleOpen(true)}
              >
                {customDays.length > 0 ? 'Edit Custom Schedule' : '+ Create Custom Schedule'}
              </Button>
            </Box>

            <Divider sx={{ mb: 3 }} />

            {/* First reminder timing */}
            <Box>
              <Typography variant="body2" fontWeight="medium" gutterBottom>
                First Reminder Timing
              </Typography>
              <RadioGroup
                value={firstReminderTiming}
                onChange={(e) => setFirstReminderTiming(e.target.value)}
              >
                <FormControlLabel
                  value="immediate"
                  control={<Radio size="small" />}
                  label={<Typography variant="body2">Send immediately after creating this request</Typography>}
                />
                <FormControlLabel
                  value="scheduled"
                  control={<Radio size="small" />}
                  label={<Typography variant="body2">Schedule for a specific date and time</Typography>}
                />
              </RadioGroup>

              {firstReminderTiming === 'scheduled' && (
                <Box display="flex" gap={2} mt={2} flexWrap="wrap" ml={{ xs: 0, sm: 3.5 }}>
                  <DatePicker
                    label="Start Date"
                    value={scheduledDate}
                    onChange={(v) => setScheduledDate(v)}
                    slotProps={{
                      textField: { size: 'small', sx: { flex: 1, minWidth: 160 } },
                    }}
                  />
                  <TimePicker
                    label="Start Time"
                    value={scheduledTime}
                    onChange={(v) => setScheduledTime(v)}
                    slotProps={{
                      textField: { size: 'small', sx: { flex: 1, minWidth: 160 } },
                    }}
                  />
                </Box>
              )}
            </Box>
          </Paper>

          {/* ── Submit row ── */}
          <Box display="flex" justifyContent="flex-end" gap={2} pb={2}>
            <Button
              variant="outlined"
              onClick={() => navigate('/')}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={loading}
              startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <SendIcon />}
              sx={{ minWidth: 180 }}
            >
              {loading ? 'Creating…' : 'Create Request'}
            </Button>
          </Box>
        </Box>

        {/* ── Custom Schedule Dialog ── */}
        <Dialog
          open={customScheduleOpen}
          onClose={() => { setCustomScheduleOpen(false); setCustomScheduleError(null); setNewDayInput(''); }}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Typography variant="h6" component="span">Custom Schedule</Typography>
              <IconButton size="small" onClick={() => { setCustomScheduleOpen(false); setCustomScheduleError(null); setNewDayInput(''); }}>
                <CloseIcon />
              </IconButton>
            </Box>
          </DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
              Enter the number of days before the due date you want reminders sent. You can add up to 30 days.
            </Typography>

            {customScheduleError && (
              <Alert severity="error" sx={{ mb: 2 }} onClose={() => setCustomScheduleError(null)}>
                {customScheduleError}
              </Alert>
            )}

            <Box display="flex" gap={1} mb={2.5}>
              <TextField
                label="Days before due date"
                type="number"
                value={newDayInput}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '' || (Number(v) > 0 && Number(v) <= 365)) setNewDayInput(v);
                  setCustomScheduleError(null);
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCustomDay(); } }}
                inputProps={{ min: 1, max: 365 }}
                size="small"
                fullWidth
                helperText="Between 1 and 365"
              />
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={handleAddCustomDay}
                disabled={!newDayInput || isNaN(parseInt(newDayInput))}
                sx={{ height: 40, flexShrink: 0 }}
              >
                Add
              </Button>
            </Box>

            {customDays.length > 0 ? (
              <Box>
                <Typography variant="body2" fontWeight="medium" gutterBottom>
                  Your schedule ({customDays.length} day{customDays.length !== 1 ? 's' : ''}):
                </Typography>
                <Box display="flex" flexWrap="wrap" gap={1}>
                  {customDays
                    .sort((a, b) => b - a)
                    .map((day) => (
                      <Chip
                        key={day}
                        label={`${day} day${day !== 1 ? 's' : ''} before`}
                        onDelete={() => setCustomDays(customDays.filter((d) => d !== day))}
                      />
                    ))}
                </Box>
              </Box>
            ) : (
              <Typography variant="body2" color="text.disabled">
                No days added yet.
              </Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => { setCustomScheduleOpen(false); setCustomScheduleError(null); setNewDayInput(''); }}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              disabled={customDays.length === 0}
              onClick={() => {
                if (customDays.length === 0) { setCustomScheduleError('Add at least one day.'); return; }
                setReminderSchedule('custom');
                setCustomScheduleOpen(false);
                setCustomScheduleError(null);
                setNewDayInput('');
              }}
            >
              Save Schedule
            </Button>
          </DialogActions>
        </Dialog>
      </Container>
    </LocalizationProvider>
  );
}