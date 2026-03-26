import { type ReactNode, useState, useEffect } from 'react';
import {
  Box,
  Modal,
  Fade,
  Backdrop,
  IconButton,
  Button,
  Typography,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

// 1. Define Props
interface AnimatedInfoButtonProps {
  title?: string;
  children: ReactNode;
}

export default function AnimatedInfoButton({ 
  title = "How to use this page", 
  children 
}: AnimatedInfoButtonProps) {
  const [open, setOpen] = useState(false);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const handleOpen = () => setOpen(true);
  
  const handleClose = () => {
    setOpen(false);
    // Reset tilt when closing so it's flat next time it opens
    setTimeout(() => setTilt({ x: 0, y: 0 }), 300); 
  };

  // 2. Track mouse globally when modal is open
  useEffect(() => {
    // If the modal isn't open, don't waste resources tracking the mouse
    if (!open) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      // Get the current window dimensions
      const width = window.innerWidth;
      const height = window.innerHeight;

      // Normalize mouse coordinates to a scale of -1 to 1
      // 0,0 is the exact center of the screen
      const normalizedX = (e.clientX / width) * 2 - 1;
      const normalizedY = (e.clientY / height) * 2 - 1;

      // Set maximum tilt angle (in degrees). Tweak this if it's too subtle or extreme!
      const maxTilt = 2;

      // Calculate the rotation. We invert the Y axis so pushing "up" tilts the top away.
      setTilt({
        x: -normalizedY * maxTilt,
        y: normalizedX * maxTilt,
      });
    };

    // Attach the listener to the whole window
    window.addEventListener('mousemove', handleGlobalMouseMove);

    // Cleanup function to remove the listener when modal closes or component unmounts
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
    };
  }, [open]); // Re-run this effect whenever 'open' changes

  return (
    <>
      <IconButton
        onClick={handleOpen}
        color="primary"
        sx={{
          bgcolor: 'primary.50',
          '&:hover': {
            transform: 'scale(1.1)',
            transition: 'transform 0.2s ease-in-out',
          },
        }}
      >
        <InfoOutlinedIcon />
      </IconButton>

      <Modal
        open={open}
        onClose={handleClose}
        closeAfterTransition
        slots={{ backdrop: Backdrop }}
        slotProps={{
          backdrop: {
            timeout: 500,
            sx: { backdropFilter: 'blur(2px)', bgcolor: 'rgba(0, 0, 0, 0.2)' },
          },
        }}
      >
        <Fade in={open}>
          {/* OUTER WRAPPER: Handles centering and 3D perspective */}
          <Box 
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: { xs: '90%', sm: 450 },
              perspective: '1000px', 
              outline: 'none',
            }}
          >
            {/* INNER CARD: Removed mouse events here since window handles it now */}
            <Box
              sx={{
                bgcolor: 'background.paper',
                borderRadius: 3,
                boxShadow: '0 12px 40px 0 rgba(0, 0, 0, 0.4)',
                p: 4,
                // Apply the dynamic rotation calculated in our useEffect
                transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
                // Smooth out the movement so it feels physical, not jerky
                transition: 'transform 0.15s ease-out',
                transformStyle: 'preserve-3d',
                willChange: 'transform',
              }}
            >
              <Typography variant="h5" component="h2" fontWeight="bold" gutterBottom>
                {title}
              </Typography>
              
              <Box sx={{ mt: 2, mb: 4, color: 'text.secondary', lineHeight: 1.6 }}>
                {children}
              </Box>

              <Button 
                variant="contained" 
                onClick={handleClose} 
                fullWidth
                size="large"
                sx={{ 
                  borderRadius: 2, 
                  textTransform: 'none', 
                  fontSize: '1.05rem',
                  transition: 'transform 0.2s',
                  '&:hover': { transform: 'translateY(-2px)' }
                }}
              >
                Continue
              </Button>
            </Box>
          </Box>
        </Fade>
      </Modal>
    </>
  );
}