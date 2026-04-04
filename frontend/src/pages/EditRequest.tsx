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
  Skeleton,
} from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CloseIcon from '@mui/icons-material/Close';
import DescriptionIcon from '@mui/icons-material/Description';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import AssignmentIcon from '@mui/icons-material/Assignment';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';

import API_URL from '../config';
import AnimatedInfoButton from '../components/InfoButton';

interface Group {
  id: string;
  name: string;
  member_count: number;
}

export default function EditRequest() {
  const { requestId } = useParams<{ requestId: string }>();
  const navigate = useNavigate();

  // Form State
  const [provider, setProvider] = useState('google');
  const [requestTitle, setRequestTitle] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [groupId, setGroupId] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [dueDate, setDueDate] = useState<Date | null>(null);

  // Schedule State
  const [reminderSchedule, setReminderSchedule] = useState('normal');
  const [firstReminderTiming, setFirstReminderTiming] = useState('immediate');
  const [scheduledDate, setScheduledDate] = useState<Date | null>(null);
  const [scheduledTime, setScheduledTime] = useState<Date | null>(null);

  // Custom Schedule
  const [customScheduleOpen, setCustomScheduleOpen] = useState(false);
  const [customDays, setCustomDays] = useState<number[]>([]);
  const [newDayInput, setNewDayInput] = useState<string>('');
  const [customScheduleError, setCustomScheduleError] = useState<string | null>(null);

  // UI State
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadInitialData();
  }, [requestId]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const groupsRes = await fetch(`${API_URL}/api/groups`, { credentials: 'include' });
      const groupsData = await groupsRes.json();
      setGroups(groupsData.groups || []);

      const requestRes = await fetch(
        `${API_URL}/api/form-requests/${requestId}/responses`,
        { credentials: 'include' }
      );
      if (!requestRes.ok) throw new Error('Failed to load request details');
      const requestData = await requestRes.json();
      const request = requestData.form_request;

      setRequestTitle(request.title);
      setFormUrl(request.form_url);
      setGroupId(request.group_id || '');
      setProvider(request.provider || 'google');

      if (request.due_date) {
        const parsedDate = new Date(request.due_date);
        if (!isNaN(parsedDate.getTime())) setDueDate(parsedDate);
      }

      if (request.reminder_schedule) {
        if (typeof request.reminder_schedule === 'object' && request.reminder_schedule !== null) {
          setReminderSchedule(request.reminder_schedule.schedule_type || 'normal');
          if (request.reminder_schedule.custom_days)
            setCustomDays(request.reminder_schedule.custom_days);
        } else {
          setReminderSchedule(request.reminder_schedule);
        }
      }

      if (request.first_reminder_timing) {
        let timingType = 'immediate';
        if (typeof request.first_reminder_timing === 'object') {
          timingType = request.first_reminder_timing.timing_type || 'immediate';
          if (timingType === 'scheduled') {
            if (request.first_reminder_timing.scheduled_date)
              setScheduledDate(new Date(request.first_reminder_timing.scheduled_date));
            if (request.first_reminder_timing.scheduled_time)
              setScheduledTime(new Date(request.first_reminder_timing.scheduled_time));
          }
        } else {
          timingType = request.first_reminder_timing;
        }
        setFirstReminderTiming(timingType);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      if (!formUrl || !groupId || !dueDate)
        throw new Error('Please fill in all required fields');

      const requestBody: any = {
        title: requestTitle,
        form_url: formUrl,
        group_id: groupId,
        due_date: dueDate.toISOString(),
        reminder_schedule: reminderSchedule,
        first_reminder_timing: firstReminderTiming,
      };

      if (reminderSchedule === 'custom') {
        if (!customDays || customDays.length === 0)
          throw new Error('Please add at least one day for the custom schedule');
        requestBody.custom_days = customDays;
      }

      if (firstReminderTiming === 'scheduled') {
        if (!scheduledDate || !scheduledTime)
          throw new Error('Please select a date and time for the scheduled reminder');
        const combined = new Date(scheduledDate);
        combined.setHours(scheduledTime.getHours());
        combined.setMinutes(scheduledTime.getMinutes());
        requestBody.scheduled_time = combined.toISOString();
      }

      const response = await fetch(`${API_URL}/api/form-requests/${requestId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(requestBody),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update request');

      navigate(`/request/${requestId}`);
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 2, mb: 3 }} />
        <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 3, mb: 3 }} />
        <Skeleton variant="rectangular" height={320} sx={{ borderRadius: 3 }} />
      </Container>
    );
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Container maxWidth="md" sx={{ py: 4 }} className="page-fade-in">
        {/* ── Top nav ── */}
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
          <Button
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate(`/request/${requestId}`)}
            sx={{ color: 'text.secondary' }}
          >
            Back to Request
          </Button>
          <Button
            variant="outlined"
            startIcon={<VisibilityIcon />}
            onClick={() => navigate(`/request/${requestId}`)}
          >
            View Request
          </Button>
        </Box>

        {/* Title block */}
        <Box display="flex" alignItems="center" gap={1.5} mb={3}>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 2,
              bgcolor: 'primary.50',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <AssignmentIcon color="primary" sx={{ fontSize: 22 }} />
          </Box>
          <Box>
            <Typography variant="h5" component="h1" fontWeight="bold">
              Edit Request      <AnimatedInfoButton title="Editing a form request">
                                  <p>Here you can update the details of your form request.</p>
                                  <p>Make sure to click "Save Changes" after making any updates. To discard changes and return to the request details page, click "Back to Request".</p>
                                  <p>On this page, you can change the form URL, update the recipient group, set a new due date, and modify the reminder schedule.</p>
                                  <p>When setting a reminder schedule, you can choose from preset options or create a custom schedule with specific days before the due date.</p>
                                </AnimatedInfoButton>
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {requestTitle || 'Untitled Request'}
            </Typography>
          </Box>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* ── Section 1: General Information ── */}
        <Paper
          elevation={0}
          sx={{
            p: { xs: 3, sm: 4 },
            mb: 3,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 3,
          }}
        >
          <Box display="flex" alignItems="center" gap={2} mb={3}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 2,
                bgcolor: 'primary.50',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <DescriptionIcon color="primary" sx={{ fontSize: 22 }} />
            </Box>
            <Box>
              <Typography variant="subtitle1" fontWeight="bold">
                General Information
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Basic details for this form request.
              </Typography>
            </Box>
          </Box>

          <Divider sx={{ mb: 3 }} />

          <Box display="grid" gap={2.5}>
            <Box>
              <Typography variant="body2" fontWeight="medium" gutterBottom>
                Form Provider
              </Typography>
              <Chip
                label={provider === 'google' ? 'Google Forms' : provider === 'jotform' ? 'Jotform' : 'Microsoft Forms'}
                size="small"
                color={provider === 'google' ? 'primary' : provider === 'jotform' ? 'warning' : 'info'}
              />
            </Box>
            <TextField
              label="Request Title"
              fullWidth
              size="small"
              value={requestTitle}
              onChange={(e) => setRequestTitle(e.target.value)}
            />
            <TextField
              label="Form URL"
              fullWidth
              size="small"
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              placeholder="https://forms.google.com/..."
            />
            <FormControl fullWidth size="small">
              <InputLabel>Recipient Group</InputLabel>
              <Select
                value={groupId}
                label="Recipient Group"
                onChange={(e) => setGroupId(e.target.value)}
              >
                {groups.map((group) => (
                  <MenuItem key={group.id} value={group.id}>
                    {group.name} ({group.member_count} members)
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </Paper>

        {/* ── Section 2: Schedule & Deadlines ── */}
        <Paper
          elevation={0}
          sx={{
            p: { xs: 3, sm: 4 },
            mb: 3,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 3,
          }}
        >
          <Box display="flex" alignItems="center" gap={2} mb={3}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 2,
                bgcolor: 'info.50',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <CalendarTodayIcon sx={{ color: 'info.main', fontSize: 22 }} />
            </Box>
            <Box>
              <Typography variant="subtitle1" fontWeight="bold">
                Schedule & Deadlines
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Set a due date and how often reminders are sent.
              </Typography>
            </Box>
          </Box>

          <Divider sx={{ mb: 3 }} />

          {/* Due Date */}
          <Box mb={3}>
            <Typography variant="body2" fontWeight="medium" gutterBottom>
              Due Date
            </Typography>
            <DatePicker
              value={dueDate}
              onChange={(v) => setDueDate(v)}
              slotProps={{ textField: { size: 'small', fullWidth: true } }}
            />
          </Box>

          <Divider sx={{ mb: 3 }} />

          {/* Reminder Frequency */}
          <Box mb={3}>
            <Typography variant="body2" fontWeight="medium" gutterBottom>
              Reminder Frequency
            </Typography>
            <FormControl component="fieldset" fullWidth>
              <RadioGroup
                value={reminderSchedule}
                onChange={(e) => {
                  setReminderSchedule(e.target.value);
                  if (e.target.value !== 'custom') setCustomDays([]);
                }}
              >
                <FormControlLabel value="gentle" control={<Radio size="small" />} label="Gentle — 3 and 1 days before" />
                <FormControlLabel value="normal" control={<Radio size="small" />} label="Normal — 5, 3, and 1 days before" />
                <FormControlLabel value="frequent" control={<Radio size="small" />} label="Frequent — Daily for the last week" />
                <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                  <FormControlLabel value="custom" control={<Radio size="small" />} label="Custom" />
                  {reminderSchedule === 'custom' && (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setCustomScheduleOpen(true)}
                    >
                      Edit Schedule ({customDays.length} days)
                    </Button>
                  )}
                </Box>
              </RadioGroup>
            </FormControl>
          </Box>

          <Divider sx={{ mb: 3 }} />

          {/* First Reminder Timing */}
          <Box>
            <Typography variant="body2" fontWeight="medium" gutterBottom>
              First Reminder Timing
            </Typography>
            <FormControl component="fieldset">
              <RadioGroup
                row
                value={firstReminderTiming}
                onChange={(e) => setFirstReminderTiming(e.target.value)}
              >
                <FormControlLabel value="immediate" control={<Radio size="small" />} label="Send immediately" />
                <FormControlLabel value="scheduled" control={<Radio size="small" />} label="Schedule for later" />
              </RadioGroup>
            </FormControl>

            {firstReminderTiming === 'scheduled' && (
              <Box display="flex" gap={2} mt={2} flexWrap="wrap">
                <DatePicker
                  label="Start Date"
                  value={scheduledDate}
                  onChange={(v) => setScheduledDate(v)}
                  slotProps={{ textField: { size: 'small', fullWidth: true, sx: { flex: 1, minWidth: 160 } } }}
                />
                <TimePicker
                  label="Start Time"
                  value={scheduledTime}
                  onChange={(v) => setScheduledTime(v)}
                  slotProps={{ textField: { size: 'small', fullWidth: true, sx: { flex: 1, minWidth: 160 } } }}
                />
              </Box>
            )}
          </Box>
        </Paper>

        {/* ── Save / Cancel row ── */}
        <Box display="flex" gap={2} justifyContent="flex-end">
          <Button
            variant="outlined"
            onClick={() => navigate(`/request/${requestId}`)}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={
              saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />
            }
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </Box>

        {/* ── Custom Schedule Dialog ── */}
        <Dialog
          open={customScheduleOpen}
          onClose={() => setCustomScheduleOpen(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              Edit Custom Schedule
              <IconButton size="small" onClick={() => setCustomScheduleOpen(false)}>
                <CloseIcon />
              </IconButton>
            </Box>
          </DialogTitle>
          <DialogContent>
            {customScheduleError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {customScheduleError}
              </Alert>
            )}
            <Box display="flex" gap={1} mb={3} mt={1}>
              <TextField
                label="Days before due date"
                type="number"
                size="small"
                fullWidth
                value={newDayInput}
                onChange={(e) => setNewDayInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const day = parseInt(newDayInput);
                    if (isNaN(day) || day < 1 || day > 365) {
                      setCustomScheduleError('Enter a number between 1 and 365');
                      return;
                    }
                    if (!customDays.includes(day)) setCustomDays([...customDays, day]);
                    setNewDayInput('');
                    setCustomScheduleError(null);
                  }
                }}
              />
              <Button
                variant="contained"
                onClick={() => {
                  const day = parseInt(newDayInput);
                  if (isNaN(day) || day < 1 || day > 365) {
                    setCustomScheduleError('Enter a number between 1 and 365');
                    return;
                  }
                  if (!customDays.includes(day)) setCustomDays([...customDays, day]);
                  setNewDayInput('');
                  setCustomScheduleError(null);
                }}
              >
                Add
              </Button>
            </Box>
            <Box display="flex" flexWrap="wrap" gap={1}>
              {customDays
                .sort((a, b) => b - a)
                .map((day) => (
                  <Chip
                    key={day}
                    label={`${day} days before`}
                    onDelete={() => setCustomDays(customDays.filter((d) => d !== day))}
                  />
                ))}
              {customDays.length === 0 && (
                <Typography variant="body2" color="text.disabled">
                  No days added yet.
                </Typography>
              )}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCustomScheduleOpen(false)} variant="contained">
              Done
            </Button>
          </DialogActions>
        </Dialog>
      </Container>
    </LocalizationProvider>
  );
}