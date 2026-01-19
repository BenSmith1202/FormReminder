import { useState, useEffect, useRef } from 'react';
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
  FormLabel,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Chip,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import {
  Description as DescriptionIcon,
  Link as LinkIcon,
  Group as GroupIcon,
  CalendarToday as CalendarIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { StaticDatePicker } from '@mui/x-date-pickers/StaticDatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';

const API_URL = 'http://localhost:5000';

interface Group {
  id: string;
  name: string;
  member_count: number;
}

export default function CreateRequest() {
  const navigate = useNavigate();
  const [requestTitle, setRequestTitle] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [groupId, setGroupId] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [dueDate, setDueDate] = useState<Date | null>(new Date());
  const [reminderSchedule, setReminderSchedule] = useState('normal');
  const [firstReminderTiming, setFirstReminderTiming] = useState('immediate');
  const [scheduledDate, setScheduledDate] = useState<Date | null>(null);
  const [scheduledTime, setScheduledTime] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduledTimeOpen, setScheduledTimeOpen] = useState(false);
  const [highlightImmediate, setHighlightImmediate] = useState(false);
  const scheduledDatePickerRef = useRef<HTMLDivElement>(null);
  const [customScheduleOpen, setCustomScheduleOpen] = useState(false);
  const [customDays, setCustomDays] = useState<number[]>([]);
  const [newDayInput, setNewDayInput] = useState<string>('');
  const [customScheduleError, setCustomScheduleError] = useState<string | null>(null);

  useEffect(() => {
    loadGroups();
  }, []);

  // Handle cancel button click on scheduled date picker
  useEffect(() => {
    if (!scheduledDatePickerRef.current || firstReminderTiming !== 'scheduled') {
      return;
    }

    const handleActionButtonClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const button = target.closest('button');
      
      if (!button) return;

      // Check if the clicked element is in the action bar
      const actionBar = button.closest('.MuiPickersActionBar-root');
      if (actionBar) {
        const buttons = Array.from(actionBar.querySelectorAll('button'));
        const buttonIndex = buttons.indexOf(button);
        const buttonText = button.textContent?.toLowerCase() || '';
        const buttonAriaLabel = button.getAttribute('aria-label')?.toLowerCase() || '';
        const buttonDataAction = button.getAttribute('data-action') || '';
        
        // Determine if it's cancel (first button or has cancel text)
        const isCancelButton = 
          buttonIndex === 0 || // First button is usually cancel
          buttonText.includes('cancel') ||
          buttonDataAction === 'cancel' ||
          buttonAriaLabel.includes('cancel');

        // Determine if it's accept/ok (second button or has accept/ok text)
        const isAcceptButton = 
          buttonIndex === 1 || // Second button is usually accept
          buttonText.includes('accept') ||
          buttonText.includes('ok') ||
          buttonDataAction === 'accept' ||
          buttonAriaLabel.includes('accept') ||
          buttonAriaLabel.includes('ok');

        if (isCancelButton) {
          e.preventDefault();
          e.stopPropagation();
          
          // Clear scheduled values
          setScheduledDate(null);
          setScheduledTime(null);
          
          // Switch back to immediate
          setFirstReminderTiming('immediate');
          
          // Trigger highlight animation
          setHighlightImmediate(true);
          setTimeout(() => {
            setHighlightImmediate(false);
          }, 1500);
        } else if (isAcceptButton) {
          // Accept button - ensure the selected date is saved
          // The date should already be saved via onChange, but we can confirm it here
          if (scheduledDate) {
            // Date is already saved, just ensure it's persisted
            console.log('Date accepted:', scheduledDate);
          }
        }
      }
    };

    // Wait for calendar to render, then attach listener
    const timer = setTimeout(() => {
      const container = scheduledDatePickerRef.current;
      if (container) {
        container.addEventListener('click', handleActionButtonClick, true);
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      if (scheduledDatePickerRef.current) {
        scheduledDatePickerRef.current.removeEventListener('click', handleActionButtonClick, true);
      }
    };
  }, [firstReminderTiming]);

  const loadGroups = async () => {
    try {
      const response = await fetch(`${API_URL}/api/groups`, {
        credentials: 'include',
      });
      const data = await response.json();
      setGroups(data.groups || []);
    } catch (error) {
      console.error('Failed to load groups:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!formUrl) {
      setError('Please enter a form URL');
      return;
    }
    
    if (!groupId) {
      setError('Please select a group');
      return;
    }
    
    if (!dueDate) {
      setError('Please select a due date');
      return;
    }

    if (firstReminderTiming === 'scheduled' && (!scheduledDate || !scheduledTime)) {
      setError('Please select both date and time for scheduled reminder');
      return;
    }

    setLoading(true);
    
    try {
      // Prepare the request body with all form data
      const requestBody: any = {
        form_url: formUrl,
        group_id: groupId,
        title: requestTitle || undefined,
        due_date: dueDate.toISOString(),
        reminder_schedule: reminderSchedule,
        first_reminder_timing: firstReminderTiming,
      };

      // Add custom_days if custom schedule is selected
      if (reminderSchedule === 'custom') {
        if (!customDays || customDays.length === 0) {
          setError('Please create a custom schedule with at least one day');
          setLoading(false);
          return;
        }
        requestBody.custom_days = customDays;
      }

      // Add scheduled date/time if scheduled option is selected
      if (firstReminderTiming === 'scheduled' && scheduledDate && scheduledTime) {
        requestBody.scheduled_date = scheduledDate.toISOString();
        requestBody.scheduled_time = scheduledTime.toISOString();
      }

      const response = await fetch(`${API_URL}/api/form-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(requestBody)
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create form request');
      }
      
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Failed to create form request');
    } finally {
      setLoading(false);
    }
  };


  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Box sx={{ width: '100%', maxWidth: 1400, mx: 'auto', py: 4, px: 3 }}>
        <Typography 
          variant="h4" 
          component="h1" 
          sx={{ 
            mb: 4, 
            fontWeight: 600,
            color: 'text.primary'
          }}
        >
          Create a New Form Request
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Paper 
          elevation={0}
          sx={{ 
            p: 5, 
            bgcolor: 'background.paper',
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'divider'
          }}
        >
          <form onSubmit={handleSubmit}>
            {/* Request Title */}
            <Box sx={{ mb: 5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
                <DescriptionIcon sx={{ mr: 1.5, color: 'text.secondary', fontSize: 20 }} />
                <Typography variant="subtitle1" fontWeight={600} sx={{ fontSize: '1rem' }}>
                  Request Title
                </Typography>
              </Box>
              <TextField
                fullWidth
                placeholder="Enter a title for this request"
                value={requestTitle}
                onChange={(e) => setRequestTitle(e.target.value)}
                sx={{ mt: 1.5 }}
                variant="outlined"
              />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block', ml: 0.5 }}>
                A short name to help you identify this request.
              </Typography>
            </Box>

            {/* Form URL */}
            <Box sx={{ mb: 5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
                <LinkIcon sx={{ mr: 1.5, color: 'text.secondary', fontSize: 20 }} />
                <Typography variant="subtitle1" fontWeight={600} sx={{ fontSize: '1rem' }}>
                  Form URL
                </Typography>
              </Box>
              <TextField
                fullWidth
                placeholder="Paste the link to the online form here"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                required
                sx={{ mt: 1.5 }}
                variant="outlined"
              />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block', ml: 0.5 }}>
                Paste the link to the online form here.
              </Typography>
            </Box>

            {/* Form Recipients */}
            <Box sx={{ mb: 5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
                <GroupIcon sx={{ mr: 1.5, color: 'text.secondary', fontSize: 20 }} />
                <Typography variant="subtitle1" fontWeight={600} sx={{ fontSize: '1rem' }}>
                  Form Recipients
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mt: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ color: 'text.secondary', minWidth: 'fit-content' }}>
                  Select your group
                </Typography>
                <FormControl sx={{ minWidth: 250, flex: 1, maxWidth: 400 }}>
                  <InputLabel>List of Groups</InputLabel>
                  <Select
                    value={groupId}
                    label="List of Groups"
                    onChange={(e) => setGroupId(e.target.value)}
                    required
                  >
                    {groups.length === 0 ? (
                      <MenuItem disabled>No groups available</MenuItem>
                    ) : (
                      groups.map((group) => (
                        <MenuItem key={group.id} value={group.id}>
                          {group.name}
                        </MenuItem>
                      ))
                    )}
                  </Select>
                </FormControl>
                <Typography variant="body2" sx={{ color: 'text.secondary', minWidth: 'fit-content' }}>
                  Or create new group
                </Typography>
                <Button
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={() => navigate('/groups/new')}
                  sx={{ minWidth: 'fit-content' }}
                >
                  New Group +
                </Button>
              </Box>
            </Box>

            {/* Select Form Due Date */}
            <Box sx={{ mb: 5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
                <CalendarIcon sx={{ mr: 1.5, color: 'text.secondary', fontSize: 20 }} />
                <Typography variant="subtitle1" fontWeight={600} sx={{ fontSize: '1rem' }}>
                  Select Form Due Date
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 4, mt: 2, flexDirection: { xs: 'column', lg: 'row' } }}>
                <Box sx={{ flex: 1, minWidth: 300 }}>
                  <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
                    Select Due Date
                  </Typography>
                  <Box
                    sx={{
                      border: '2px solid',
                      borderColor: '#000000',
                      borderRadius: 2,
                      overflow: 'hidden',
                      bgcolor: 'background.paper',
                    }}
                  >
                    <StaticDatePicker
                      value={dueDate}
                      onChange={(newValue) => {
                        if (newValue) {
                          setDueDate(newValue);
                        }
                      }}
                      slotProps={{
                        actionBar: {
                          actions: [],
                        },
                      }}
                      sx={{
                        '& .MuiPickersCalendarHeader-root': {
                          borderBottom: '2px solid',
                          borderColor: 'text.primary',
                          mb: 1,
                        },
                        '& .MuiDayCalendar-weekContainer': {
                          borderBottom: '1px solid',
                          borderColor: 'text.secondary',
                        },
                        '& .MuiPickersDay-root': {
                          border: '1px solid',
                          borderColor: 'text.secondary',
                          '&:not(:last-child)': {
                            borderRight: '1px solid',
                            borderColor: 'text.secondary',
                          },
                        },
                        '& .MuiPickersCalendarHeader-labelContainer': {
                          borderBottom: '1px solid',
                          borderColor: 'text.secondary',
                        },
                      }}
                    />
                  </Box>
                </Box>
                <Box sx={{ flex: 1, minWidth: 300 }}>
                  <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5, fontSize: '0.95rem' }}>
                    Reminder Schedule
                  </Typography>
                  <FormControl component="fieldset" fullWidth>
                    <FormLabel component="legend" sx={{ fontSize: '0.875rem', mb: 1.5, color: 'text.secondary' }}>
                      Choose how often to send reminders:
                    </FormLabel>
                    <RadioGroup
                      value={reminderSchedule}
                      onChange={(e) => {
                        const newSchedule = e.target.value;
                        setReminderSchedule(newSchedule);
                        // Clear custom days if switching away from custom
                        if (newSchedule !== 'custom') {
                          setCustomDays([]);
                        }
                      }}
                      sx={{ gap: 0.5 }}
                    >
                      <FormControlLabel
                        value="gentle"
                        control={<Radio size="small" />}
                        label={
                          <Typography variant="body2">
                            Gentle: remind recipients 3 and 1 days before due date
                          </Typography>
                        }
                      />
                      <FormControlLabel
                        value="normal"
                        control={<Radio size="small" />}
                        label={
                          <Typography variant="body2">
                            Normal: remind recipients 5, 3, and 1 days before due date
                          </Typography>
                        }
                      />
                      <FormControlLabel
                        value="frequent"
                        control={<Radio size="small" />}
                        label={
                          <Typography variant="body2">
                            Frequent: remind recipients 14, 7, 6, 5, 4, 3, 2, and 1 days before due date
                          </Typography>
                        }
                      />
                      {customDays.length > 0 && (
                        <FormControlLabel
                          value="custom"
                          control={<Radio size="small" />}
                          label={
                            <Typography variant="body2">
                              Custom: remind recipients {customDays.sort((a, b) => b - a).join(', ')} day{customDays.length !== 1 ? 's' : ''} before due date
                            </Typography>
                          }
                        />
                      )}
                    </RadioGroup>
                    <Button
                      variant="text"
                      size="small"
                      sx={{ mt: 1.5, alignSelf: 'flex-start', textTransform: 'none' }}
                      onClick={() => {
                        setCustomScheduleOpen(true);
                      }}
                    >
                      Create a Custom Schedule
                    </Button>
                    {reminderSchedule === 'custom' && customDays.length > 0 && (
                      <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          Custom schedule: Remind recipients
                        </Typography>
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
                                if (updated.length === 0) {
                                  setReminderSchedule('normal');
                                }
                              }}
                            />
                          ))}
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          before due date
                        </Typography>
                      </Box>
                    )}
                  </FormControl>
                </Box>
              </Box>
            </Box>

            {/* First Reminder Timing */}
            <Box sx={{ mb: 5 }}>
              <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1, fontSize: '1rem' }}>
                First Reminder Timing
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                When should the first reminder be sent?
              </Typography>
              <FormControl component="fieldset" sx={{ mb: 2 }}>
                <RadioGroup
                  value={firstReminderTiming}
                  onChange={(e) => setFirstReminderTiming(e.target.value)}
                  sx={{ gap: 1 }}
                >
                  <FormControlLabel
                    value="immediate"
                    control={<Radio />}
                    label={
                      <Typography variant="body2">
                        Send Immediately after first creating this request
                      </Typography>
                    }
                    sx={{
                      animation: highlightImmediate ? 'highlightSwitch 1.5s ease-in-out' : 'none',
                      '@keyframes highlightSwitch': {
                        '0%': {
                          backgroundColor: 'transparent',
                          transform: 'scale(1)',
                          boxShadow: 'none',
                        },
                        '20%': {
                          backgroundColor: 'rgba(25, 118, 210, 0.2)',
                          transform: 'scale(1.05)',
                          boxShadow: '0 4px 12px rgba(25, 118, 210, 0.3)',
                        },
                        '40%': {
                          backgroundColor: 'rgba(25, 118, 210, 0.15)',
                          transform: 'scale(1.03)',
                          boxShadow: '0 2px 8px rgba(25, 118, 210, 0.2)',
                        },
                        '60%': {
                          backgroundColor: 'rgba(25, 118, 210, 0.2)',
                          transform: 'scale(1.05)',
                          boxShadow: '0 4px 12px rgba(25, 118, 210, 0.3)',
                        },
                        '80%': {
                          backgroundColor: 'rgba(25, 118, 210, 0.1)',
                          transform: 'scale(1.02)',
                          boxShadow: '0 2px 6px rgba(25, 118, 210, 0.15)',
                        },
                        '100%': {
                          backgroundColor: 'transparent',
                          transform: 'scale(1)',
                          boxShadow: 'none',
                        },
                      },
                      borderRadius: 2,
                      px: highlightImmediate ? 2 : 0,
                      py: highlightImmediate ? 1 : 0,
                      mx: highlightImmediate ? -2 : 0,
                      my: highlightImmediate ? -1 : 0,
                      transition: 'all 0.3s ease',
                      border: highlightImmediate ? '2px solid rgba(25, 118, 210, 0.5)' : '2px solid transparent',
                    }}
                  />
                  <FormControlLabel
                    value="scheduled"
                    control={<Radio />}
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Typography variant="body2">Schedule first reminder for</Typography>
                      </Box>
                    }
                  />
                </RadioGroup>
              </FormControl>
              
              {firstReminderTiming === 'scheduled' && (
                <Box sx={{ mt: 3 }}>
                  <Box sx={{ display: 'flex', gap: 4, flexDirection: { xs: 'column', lg: 'row' } }}>
                    <Box sx={{ flex: 1, minWidth: 300 }}>
                      <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
                        Select Date
                      </Typography>
                      <Box
                        ref={scheduledDatePickerRef}
                        sx={{
                          border: '2px solid',
                          borderColor: '#000000',
                          borderRadius: 2,
                          overflow: 'hidden',
                          bgcolor: 'background.paper',
                        }}
                      >
                        <StaticDatePicker
                          value={scheduledDate}
                          onChange={(newValue) => {
                            // Update date as user selects it
                            setScheduledDate(newValue);
                          }}
                          onAccept={(newValue) => {
                            // Explicitly save when OK/Accept is clicked
                            if (newValue) {
                              setScheduledDate(newValue);
                            }
                          }}
                          slotProps={{
                            actionBar: {
                              actions: ['cancel', 'accept'],
                            },
                          }}
                          sx={{
                            '& .MuiPickersCalendarHeader-root': {
                              borderBottom: '2px solid',
                              borderColor: 'text.primary',
                              mb: 1,
                            },
                            '& .MuiDayCalendar-weekContainer': {
                              borderBottom: '1px solid',
                              borderColor: 'text.secondary',
                            },
                            '& .MuiPickersDay-root': {
                              border: '1px solid',
                              borderColor: 'text.secondary',
                              '&:not(:last-child)': {
                                borderRight: '1px solid',
                                borderColor: 'text.secondary',
                              },
                            },
                            '& .MuiPickersCalendarHeader-labelContainer': {
                              borderBottom: '1px solid',
                              borderColor: 'text.secondary',
                            },
                          }}
                        />
                      </Box>
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 300 }}>
                      <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
                        Select Time
                      </Typography>
                      <TimePicker
                        label="Scheduled Time"
                        value={scheduledTime}
                        onChange={(newValue) => {
                          // Update time as user selects it
                          setScheduledTime(newValue);
                        }}
                        onAccept={(newValue) => {
                          // Explicitly save when OK/Accept is clicked
                          if (newValue) {
                            setScheduledTime(newValue);
                          }
                          setScheduledTimeOpen(false);
                        }}
                        onClose={(reason?: string) => {
                          // Handle cancel - clear time if cancelled
                          if (reason === 'cancel') {
                            setScheduledTime(null);
                          }
                          setScheduledTimeOpen(false);
                        }}
                        open={scheduledTimeOpen}
                        onOpen={() => setScheduledTimeOpen(true)}
                        slotProps={{
                          textField: {
                            fullWidth: true,
                            onClick: () => setScheduledTimeOpen(true),
                          },
                          actionBar: {
                            actions: ['cancel', 'accept'],
                          },
                        }}
                      />
                    </Box>
                  </Box>
                </Box>
              )}
            </Box>

            {/* Create Request Button */}
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 6 }}>
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={loading}
                sx={{ 
                  minWidth: 250, 
                  py: 1.75, 
                  px: 4,
                  fontSize: '1.1rem',
                  fontWeight: 600,
                  textTransform: 'none',
                  borderRadius: 2
                }}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'Create Request!'}
              </Button>
            </Box>
          </form>
        </Paper>

      </Box>

      {/* Custom Schedule Dialog */}
      <Dialog
        open={customScheduleOpen}
        onClose={() => {
          setCustomScheduleOpen(false);
          setCustomScheduleError(null);
          setNewDayInput('');
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h6">Create Custom Schedule</Typography>
            <IconButton
              onClick={() => {
                setCustomScheduleOpen(false);
                setCustomScheduleError(null);
                setNewDayInput('');
              }}
              size="small"
            >
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
            Specify how many days before the due date you want to send reminders. You can add multiple days.
          </Typography>

          {customScheduleError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setCustomScheduleError(null)}>
              {customScheduleError}
            </Alert>
          )}

          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <TextField
              label="Days before due date"
              type="number"
              value={newDayInput}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '' || (Number(value) > 0 && Number(value) <= 365)) {
                  setNewDayInput(value);
                  setCustomScheduleError(null);
                }
              }}
              inputProps={{ min: 1, max: 365 }}
              fullWidth
              size="small"
              helperText="Enter a number between 1 and 365"
            />
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
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
              }}
              disabled={!newDayInput || isNaN(parseInt(newDayInput))}
            >
              Add
            </Button>
          </Box>

          {customDays.length > 0 && (
            <Box>
              <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
                Your custom schedule ({customDays.length} day{customDays.length !== 1 ? 's' : ''}):
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {customDays
                  .sort((a, b) => b - a)
                  .map((day) => (
                    <Chip
                      key={day}
                      label={`${day} day${day !== 1 ? 's' : ''} before`}
                      onDelete={() => {
                        setCustomDays(customDays.filter((d) => d !== day));
                      }}
                      deleteIcon={<DeleteIcon />}
                    />
                  ))}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setCustomScheduleOpen(false);
              setCustomScheduleError(null);
              setNewDayInput('');
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              if (customDays.length === 0) {
                setCustomScheduleError('Please add at least one day to your schedule');
                return;
              }
              setReminderSchedule('custom');
              setCustomScheduleOpen(false);
              setCustomScheduleError(null);
              setNewDayInput('');
            }}
            disabled={customDays.length === 0}
          >
            Save Schedule
          </Button>
        </DialogActions>
      </Dialog>
    </LocalizationProvider>
  );
}
