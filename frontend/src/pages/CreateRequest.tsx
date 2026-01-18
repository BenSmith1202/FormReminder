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
  FormLabel,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  Stack,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import {
  Description as DescriptionIcon,
  Link as LinkIcon,
  Group as GroupIcon,
  CalendarToday as CalendarIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
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

  useEffect(() => {
    loadGroups();
  }, []);

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
    
    if (!groupId) {
      setError('Please select a group');
      return;
    }
    
    if (!dueDate) {
      setError('Please select a due date');
      return;
    }

    setLoading(true);
    
    try {
      const response = await fetch(`${API_URL}/api/form-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          form_url: formUrl,
          group_id: groupId,
          title: requestTitle || undefined,
        })
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
                      onChange={(newValue) => setDueDate(newValue)}
                      slotProps={{
                        actionBar: {
                          actions: ['cancel', 'ok'],
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
                      onChange={(e) => setReminderSchedule(e.target.value)}
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
                    </RadioGroup>
                    <Button
                      variant="text"
                      size="small"
                      sx={{ mt: 1.5, alignSelf: 'flex-start', textTransform: 'none' }}
                      onClick={() => {
                        alert('Custom schedule feature coming soon');
                      }}
                    >
                      Create a Custom Schedule
                    </Button>
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
                          onChange={(newValue) => setScheduledDate(newValue)}
                          slotProps={{
                            actionBar: {
                              actions: ['cancel', 'ok'],
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
                        onChange={(newValue) => setScheduledTime(newValue)}
                        open={scheduledTimeOpen}
                        onOpen={() => setScheduledTimeOpen(true)}
                        onClose={() => setScheduledTimeOpen(false)}
                        slotProps={{
                          textField: {
                            fullWidth: true,
                            onClick: () => setScheduledTimeOpen(true),
                          },
                          actionBar: {
                            actions: ['cancel', 'ok'],
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
    </LocalizationProvider>
  );
}
