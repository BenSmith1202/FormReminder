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
  Stack,
  Divider
} from '@mui/material';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Description as DescriptionIcon,
  CalendarToday as CalendarIcon,
  Close as CloseIcon,
  ArrowBack as ArrowBackIcon,
  Save as SaveIcon,
} from '@mui/icons-material';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';

import API_URL from '../config';

interface Group {
  id: string;
  name: string;
  member_count: number;
}

export default function EditRequest() {
  const { requestId } = useParams<{ requestId: string }>();
  const navigate = useNavigate();

  // Form State
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
  
  // Custom Schedule Logic
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
      // 1. Load available groups
      const groupsRes = await fetch(`${API_URL}/api/groups`, { credentials: 'include' });
      const groupsData = await groupsRes.json();
      setGroups(groupsData.groups || []);

      // 2. Load existing request details
      const requestRes = await fetch(`${API_URL}/api/form-requests/${requestId}/responses`, { credentials: 'include' });
      if (!requestRes.ok) throw new Error('Failed to load request details');
      
      const requestData = await requestRes.json();
      const request = requestData.form_request;

      // 3. Populate State
      setRequestTitle(request.title);
      setFormUrl(request.form_url);
      setGroupId(request.group_id || '');
      
      // SAFE DATE PARSING
      if (request.due_date) {
        // Handle ISO strings safely
        const parsedDate = new Date(request.due_date);
        // Only set if valid
        if (!isNaN(parsedDate.getTime())) {
          setDueDate(parsedDate);
        }
      }

      // Populate Reminder Settings
      if (request.reminder_schedule) {
        // Handle object vs string format
        if (typeof request.reminder_schedule === 'object' && request.reminder_schedule !== null) {
          setReminderSchedule(request.reminder_schedule.schedule_type || 'normal');
          if (request.reminder_schedule.custom_days) {
            setCustomDays(request.reminder_schedule.custom_days);
          }
        } else {
          setReminderSchedule(request.reminder_schedule);
        }
      }

      // Populate Timing
      if (request.first_reminder_timing) {
        // Handle object vs string format
        let timingType = 'immediate';
        if (typeof request.first_reminder_timing === 'object') {
           timingType = request.first_reminder_timing.timing_type || 'immediate';
           if (timingType === 'scheduled') {
             if (request.first_reminder_timing.scheduled_date) {
               setScheduledDate(new Date(request.first_reminder_timing.scheduled_date));
             }
             if (request.first_reminder_timing.scheduled_time) {
               setScheduledTime(new Date(request.first_reminder_timing.scheduled_time));
             }
           }
        } else {
           timingType = request.first_reminder_timing;
        }
        setFirstReminderTiming(timingType);
      }

    } catch (err: any) {
      console.error('Failed to load data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);

    try {
      if (!formUrl || !groupId || !dueDate) {
        throw new Error('Please fill in all required fields');
      }

      const requestBody: any = {
        title: requestTitle,
        form_url: formUrl,
        group_id: groupId,
        due_date: dueDate.toISOString(),
        reminder_schedule: reminderSchedule,
        first_reminder_timing: firstReminderTiming,
      };

      if (reminderSchedule === 'custom') {
        if (!customDays || customDays.length === 0) {
          throw new Error('Please add at least one day for the custom schedule');
        }
        requestBody.custom_days = customDays;
      }

      if (firstReminderTiming === 'scheduled') {
        if (!scheduledDate || !scheduledTime) {
          throw new Error('Please select a date and time for the scheduled reminder');
        }
        const combined = new Date(scheduledDate);
        combined.setHours(scheduledTime.getHours());
        combined.setMinutes(scheduledTime.getMinutes());
        requestBody.scheduled_time = combined.toISOString();
      }

      const response = await fetch(`${API_URL}/api/form-requests/${requestId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update request');
      }

      // Navigate back to view page
      navigate(`/request/${requestId}`);

    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Box maxWidth="md" sx={{ mx: 'auto', py: 4, px: 2 }}>
        
        <Box display="flex" alignItems="center" mb={4}>
          <IconButton onClick={() => navigate(`/request/${requestId}`)} sx={{ mr: 2 }}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h4" fontWeight="bold">
            Edit Request
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Stack spacing={3}>
          <Paper sx={{ p: 4, borderRadius: 2 }}>
            <Box display="flex" alignItems="center" mb={3}>
              <DescriptionIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="h6">General Information</Typography>
            </Box>
            
            <TextField
              label="Request Title"
              fullWidth
              value={requestTitle}
              onChange={(e) => setRequestTitle(e.target.value)}
              sx={{ mb: 3 }}
            />

            <TextField
              label="Form URL"
              fullWidth
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              sx={{ mb: 3 }}
            />

            <FormControl fullWidth>
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
          </Paper>

          <Paper sx={{ p: 4, borderRadius: 2 }}>
            <Box display="flex" alignItems="center" mb={3}>
              <CalendarIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="h6">Schedule & Deadlines</Typography>
            </Box>

            <Box sx={{ mb: 4 }}>
              <Typography variant="subtitle2" gutterBottom>Due Date</Typography>
              <DatePicker
                value={dueDate}
                onChange={(newValue) => setDueDate(newValue)}
                slotProps={{ textField: { fullWidth: true } }}
              />
            </Box>

            <Divider sx={{ my: 3 }} />

            <Typography variant="subtitle2" gutterBottom>Reminder Frequency</Typography>
            <FormControl component="fieldset" fullWidth>
              <RadioGroup
                value={reminderSchedule}
                onChange={(e) => {
                  setReminderSchedule(e.target.value);
                  if (e.target.value !== 'custom') setCustomDays([]);
                }}
              >
                <FormControlLabel value="gentle" control={<Radio />} label="Gentle (3 and 1 days before)" />
                <FormControlLabel value="normal" control={<Radio />} label="Normal (5, 3, and 1 days before)" />
                <FormControlLabel value="frequent" control={<Radio />} label="Frequent (Daily last week)" />
                
                <Box display="flex" alignItems="center" gap={2}>
                  <FormControlLabel value="custom" control={<Radio />} label="Custom" />
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

            <Divider sx={{ my: 3 }} />

            <Typography variant="subtitle2" gutterBottom>First Reminder Timing</Typography>
            <FormControl component="fieldset">
              <RadioGroup
                row
                value={firstReminderTiming}
                onChange={(e) => setFirstReminderTiming(e.target.value)}
              >
                <FormControlLabel value="immediate" control={<Radio />} label="Immediate" />
                <FormControlLabel value="scheduled" control={<Radio />} label="Scheduled" />
              </RadioGroup>
            </FormControl>

            {firstReminderTiming === 'scheduled' && (
              <Box display="flex" gap={2} mt={2}>
                <DatePicker
                  label="Start Date"
                  value={scheduledDate}
                  onChange={(newValue) => setScheduledDate(newValue)}
                  slotProps={{ textField: { fullWidth: true } }}
                />
                <TimePicker
                  label="Start Time"
                  value={scheduledTime}
                  onChange={(newValue) => setScheduledTime(newValue)}
                  slotProps={{ textField: { fullWidth: true } }}
                />
              </Box>
            )}
          </Paper>

          <Box display="flex" gap={2} justifyContent="flex-end" pt={2}>
            <Button
              variant="outlined"
              size="large"
              onClick={() => navigate(`/request/${requestId}`)}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              size="large"
              startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </Box>
        </Stack>

        <Dialog open={customScheduleOpen} onClose={() => setCustomScheduleOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              Edit Custom Schedule
              <IconButton size="small" onClick={() => setCustomScheduleOpen(false)}><CloseIcon /></IconButton>
            </Box>
          </DialogTitle>
          <DialogContent>
            {customScheduleError && <Alert severity="error" sx={{ mb: 2 }}>{customScheduleError}</Alert>}
            
            <Box display="flex" gap={1} mb={3} mt={1}>
              <TextField
                label="Days before due date"
                type="number"
                size="small"
                fullWidth
                value={newDayInput}
                onChange={(e) => setNewDayInput(e.target.value)}
              />
              <Button 
                variant="contained"
                onClick={() => {
                  const day = parseInt(newDayInput);
                  if (isNaN(day) || day < 1 || day > 365) {
                    setCustomScheduleError('Invalid day number');
                    return;
                  }
                  if (!customDays.includes(day)) {
                    setCustomDays([...customDays, day]);
                  }
                  setNewDayInput('');
                  setCustomScheduleError(null);
                }}
              >
                Add
              </Button>
            </Box>

            <Box display="flex" flexWrap="wrap" gap={1}>
              {customDays.sort((a, b) => b - a).map((day) => (
                <Chip
                  key={day}
                  label={`${day} days before`}
                  onDelete={() => setCustomDays(customDays.filter(d => d !== day))}
                />
              ))}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCustomScheduleOpen(false)}>Done</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </LocalizationProvider>
  );
}