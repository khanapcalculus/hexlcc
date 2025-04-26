import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Ellipse, Image, Layer, Line, Rect, Stage, Transformer } from 'react-konva';
import io from 'socket.io-client';

// --- Icon Imports ---
// Make sure these paths are correct relative to this file
import circleIcon from '../assets/icons/circle.png';
import clearIcon from '../assets/icons/clear.png';
import colorPaletteIcon from '../assets/icons/palette.png';
import eraserIcon from '../assets/icons/eraser.png';
import imageIcon from '../assets/icons/image.png';
import lineIcon from '../assets/icons/line.png';
import penIcon from '../assets/icons/pen.png';
import rectangleIcon from '../assets/icons/rectangle.png';
import selectIcon from '../assets/icons/select.png';
// import logo from '../assets/logo/logo.png'; // Logo import currently unused in rendering logic

// --- Constants ---
const colors = [
  '#000000', '#FF0000', '#00FF00', '#0000FF',
  '#FFFF00', '#FF00FF', '#00FFFF', '#800000',
  '#008000', '#000080', '#808000', '#800080',
  '#008080', '#808080', '#C0C0C0', '#FFFFFF'
];

const strokeWidths = Array.from({ length: 16 }, (_, i) => i + 1); // Widths 1 to 16

// --- Component ---
const Whiteboard = () => {
  // --- State ---
  const [pages, setPages] = useState([{ id: 1, lines: [], shapes: [] }]);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [tool, setTool] = useState('pen');
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [selectedColor, setSelectedColor] = useState('#000000');
  const [selectedStrokeWidth, setSelectedStrokeWidth] = useState(5);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showStrokePicker, setShowStrokePicker] = useState(false);
  // const [logoImage] = useState(new window.Image()); // State for logo if needed later

  // --- Refs ---
  const transformerRef = useRef(null);
  const stageRef = useRef(null);
  const socketRef = useRef(null);
  const isDrawingRef = useRef(false); // Ref to track drawing state for async updates


  // --- Socket Connection and Event Handling ---
  useEffect(() => {
    // Connect to the socket server
    const serverUrl = process.env.REACT_APP_SERVER_URL || 'http://localhost:5000';
    socketRef.current = io(serverUrl, {
      transports: ['websocket'],
      // secure: true, // Uncomment if server uses HTTPS/WSS
      reconnectionAttempts: 5,
    });

    console.log('Attempting to connect to socket server:', serverUrl);

    socketRef.current.on('connect', () => {
      console.log('Socket connected:', socketRef.current.id);
      // Optional: Request initial state from server upon connection if needed
      // socketRef.current.emit('request-initial-state');
    });

    socketRef.current.on('connect_error', (err) => {
      console.error('Socket connection error:', err);
      // You might want to display an error message to the user here
    });

    socketRef.current.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
    });

    // Handler for receiving drawing updates
    const handleDrawUpdate = (data) => {
      console.log('Received draw-update');
      if (data.pages) {
        const pagesWithImages = data.pages.map(page => ({
          ...page,
          shapes: page.shapes.map(shape => {
            // Recreate Image objects for Konva if they don't exist
            if (shape.type === 'image' && shape.image && !shape.imageObj) {
              try {
                const img = new window.Image();
                img.crossOrigin = 'anonymous'; // Important for potential canvas operations later
                img.src = shape.image; // Base64 data URL
                // Konva's <Image> component handles loading internally
                return { ...shape, imageObj: img };
              } catch (error) {
                console.error("Error creating image object from received data:", error);
                return shape; // Return original shape on error
              }
            }
            return shape;
          })
        }));
        setPages(pagesWithImages);
      }
    };

    socketRef.current.on('draw-update', handleDrawUpdate);

    // --- Cleanup on component unmount ---
    return () => {
      console.log('Disconnecting socket...');
      if (socketRef.current) {
        socketRef.current.off('draw-update', handleDrawUpdate);
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []); // Empty dependency array ensures this runs only once on mount

  // --- Emit Updates Helper ---
  const emitDrawUpdate = useCallback((updatedPages) => {
    if (socketRef.current && socketRef.current.connected) {
      // Create a serializable version (remove non-serializable Image objects)
      const serializablePages = updatedPages.map(page => ({
        ...page,
        shapes: page.shapes.map(shape => {
          if (shape.type === 'image') {
            // eslint-disable-next-line no-unused-vars
            const { imageObj, ...rest } = shape; // Remove imageObj
            return rest; // Send only serializable data
          }
          return shape;
        })
      }));
      socketRef.current.emit('draw-update', { pages: serializablePages });
    } else {
      console.warn('Socket not connected, cannot emit update.');
    }
  }, []); // No dependencies, uses refs and state captured at definition time


  // --- Transformer Attachment Logic ---
  useEffect(() => {
    if (!transformerRef.current || !stageRef.current) return;

    const tr = transformerRef.current;
    const stage = stageRef.current;
    let node = null;

    if (selectedId && tool === 'select') {
      node = stage.findOne('#' + selectedId);
    }

    if (node) {
      tr.nodes([node]);
    } else {
      tr.nodes([]); // Deselect if node not found or no ID selected
    }

    const layer = tr.getLayer();
    if (layer) {
      layer.batchDraw(); // Update the layer containing the transformer
    }

  }, [selectedId, pages, currentPage, tool]); // Re-run when selection, data, page, or tool changes

  // --- Logo Loading (if needed) ---
  // useEffect(() => {
  //   logoImage.src = logo;
  // }, [logoImage]);

  // --- Event Handlers ---

  const getPointerPos = (e) => {
    const stage = e.target.getStage();
    if (!stage) return null;
    return stage.getPointerPosition();
  };

  const handleMouseDown = (e) => {
     // Prevent default behavior for touch events, like scrolling
     if (e.evt && e.evt.preventDefault && e.type.includes('touch')) {
         e.evt.preventDefault();
     }

    const pos = getPointerPos(e);
    if (!pos) return;

    isDrawingRef.current = true; // Use ref for drawing state check in async events
    setIsDrawing(true); // State for UI feedback if needed
    setStartPos(pos);

    const currentPageIndex = currentPage - 1;
    if (currentPageIndex < 0 || currentPageIndex >= pages.length) return;

    if (tool === 'pen' || tool === 'eraser') {
      // Start a new line
      const newLine = {
        tool,
        points: [pos.x, pos.y, pos.x, pos.y], // Start with a tiny line segment
        color: tool === 'eraser' ? '#FFFFFF' : selectedColor, // Eraser uses background usually
        strokeWidth: selectedStrokeWidth,
        tension: 0.5, // Default tension for smoother curves
        lineCap: 'round',
        lineJoin: 'round',
        globalCompositeOperation: tool === 'eraser' ? 'destination-out' : 'source-over',
      };

      const updatedPages = pages.map((page, index) =>
        index === currentPageIndex
          ? { ...page, lines: [...page.lines, newLine] }
          : page
      );
      setPages(updatedPages);
      // Emit update later on mouse move/up
    } else if (tool === 'select') {
      const clickedOnEmpty = e.target === e.target.getStage();
      if (clickedOnEmpty) {
        setSelectedId(null);
      } else {
        // Check if clicked target or its parent is the transformer handle
        let target = e.target;
        while (target && target.getParent() && target.getParent().className !== 'Stage') {
          if (target.getParent().className === 'Transformer') {
            // Clicked on transformer, do nothing regarding selection change
            return;
          }
          target = target.getParent();
        }
        // If clicked on a shape (and not the transformer itself)
        if (e.target.id()) {
           setSelectedId(e.target.id());
        } else {
           setSelectedId(null); // Clicked on something without ID (like background maybe)
        }
      }
    } else if (['line', 'rectangle', 'circle'].includes(tool)) {
        // Create temporary shape for visual feedback during drawing
        const tempShape = {
            id: 'temp',
            type: tool,
            color: selectedColor,
            strokeWidth: selectedStrokeWidth,
            x: pos.x,
            y: pos.y,
            width: 0,
            height: 0,
            points: [pos.x, pos.y, pos.x, pos.y] // For line
        };
        const updatedPages = pages.map((page, index) =>
            index === currentPageIndex
                ? { ...page, shapes: [...page.shapes, tempShape] }
                : page
        );
        setPages(updatedPages);
    }
  };

  const handleMouseMove = (e) => {
    if (!isDrawingRef.current) return; // Use ref here

     // Prevent default behavior for touch events
     if (e.evt && e.evt.preventDefault && e.type.includes('touch')) {
         e.evt.preventDefault();
     }

    const pos = getPointerPos(e);
    if (!pos) return;

    const currentPageIndex = currentPage - 1;
    if (currentPageIndex < 0 || currentPageIndex >= pages.length) return;

    if (tool === 'pen' || tool === 'eraser') {
      // Update the last line's points
      const updatedPages = pages.map((page, index) => {
        if (index === currentPageIndex && page.lines.length > 0) {
          const lastLine = page.lines[page.lines.length - 1];
          const newPoints = lastLine.points.concat([pos.x, pos.y]);
          const updatedLine = { ...lastLine, points: newPoints };
          return { ...page, lines: [...page.lines.slice(0, -1), updatedLine] };
        }
        return page;
      });
      setPages(updatedPages); // Update React state

      // Throttle socket emissions during drawing for performance
       const lastLineLength = updatedPages[currentPageIndex]?.lines?.[updatedPages[currentPageIndex].lines.length - 1]?.points?.length;
       if (lastLineLength && lastLineLength % 16 === 0) { // Emit every 8 points (16 numbers)
         emitDrawUpdate(updatedPages);
       }

    } else if (['line', 'rectangle', 'circle'].includes(tool)) {
      // Update the 'temp' shape
      const updatedPages = pages.map((page, index) => {
        if (index === currentPageIndex) {
          const shapesWithoutTemp = page.shapes.filter(s => s.id !== 'temp');
          let updatedTempShape;
           if (tool === 'line') {
               updatedTempShape = {
                   id: 'temp', type: tool, color: selectedColor, strokeWidth: selectedStrokeWidth,
                   points: [startPos.x, startPos.y, pos.x, pos.y],
                   // Konva lines don't use x/y/width/height directly when points are set
                   x: 0, y: 0, width: 0, height: 0
               };
           } else { // Rectangle or Circle
               updatedTempShape = {
                   id: 'temp', type: tool, color: selectedColor, strokeWidth: selectedStrokeWidth,
                   x: Math.min(startPos.x, pos.x),
                   y: Math.min(startPos.y, pos.y),
                   width: Math.abs(pos.x - startPos.x),
                   height: Math.abs(pos.y - startPos.y)
               };
           }
          return { ...page, shapes: [...shapesWithoutTemp, updatedTempShape] };
        }
        return page;
      });
      setPages(updatedPages);
      // Optionally throttle emits here too if needed, or emit on mouse up
    }
  };

  const handleMouseUp = () => {
    if (!isDrawingRef.current) return; // Check ref before proceeding
    isDrawingRef.current = false;
    setIsDrawing(false);


    const currentPageIndex = currentPage - 1;
    if (currentPageIndex < 0 || currentPageIndex >= pages.length) return;

    let finalPages = pages; // Start with the current state

    if (['line', 'rectangle', 'circle'].includes(tool)) {
      // Finalize the shape: remove 'temp' and add permanent shape with unique ID
      finalPages = pages.map((page, index) => {
        if (index === currentPageIndex) {
          const tempShape = page.shapes.find(s => s.id === 'temp');
          if (tempShape && (tempShape.width > 0 || tempShape.height > 0 || (tempShape.points && tempShape.points.length >=4 && (tempShape.points[0] !== tempShape.points[2] || tempShape.points[1] !== tempShape.points[3]) ) ) ) {
             // Only finalize if the shape has size or line has length
            const finalShape = { ...tempShape, id: Date.now().toString() + Math.random() }; // More unique ID
            return { ...page, shapes: [...page.shapes.filter(s => s.id !== 'temp'), finalShape] };
          } else {
            // If temp shape is invalid (e.g., just a click), remove it
            return { ...page, shapes: page.shapes.filter(s => s.id !== 'temp') };
          }
        }
        return page;
      });
      setPages(finalPages); // Update state immediately
    }

    // Always emit the final state after drawing stops for any tool
    // This ensures the last segment of pen/eraser or the final shape is sent
    emitDrawUpdate(finalPages);
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      alert('Please upload a valid image file.');
      e.target.value = ''; // Reset file input
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const imageObj = new window.Image();
      imageObj.crossOrigin = 'anonymous';
      imageObj.onload = () => {
        // Calculate initial size (e.g., max width 300px, maintain aspect ratio)
        const maxWidth = 300;
        const ratio = Math.min(maxWidth / imageObj.width, 1); // Don't scale up
        const width = imageObj.width * ratio;
        const height = imageObj.height * ratio;

        // Position near center (adjust as needed)
        const stageWidth = stageRef.current?.width() || window.innerWidth;
        const stageHeight = stageRef.current?.height() || window.innerHeight;
        const x = (stageWidth / 2) - (width / 2);
        const y = (stageHeight / 2) - (height / 2);

        const newShape = {
          id: Date.now().toString() + Math.random(),
          type: 'image',
          x: x,
          y: y,
          width: width,
          height: height,
          image: reader.result, // Base64 data URL for serialization
          imageObj: imageObj,    // Image object for Konva rendering
          rotation: 0,
        };

        const currentPageIndex = currentPage - 1;
        const updatedPages = pages.map((page, index) =>
          index === currentPageIndex
            ? { ...page, shapes: [...page.shapes, newShape] }
            : page
        );

        setPages(updatedPages);
        emitDrawUpdate(updatedPages);
      };
      imageObj.onerror = () => {
          alert('Failed to load image.');
      };
      imageObj.src = reader.result;
    };
    reader.onerror = () => {
        alert('Failed to read file.');
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // Reset file input after selection
  };

  const handleDragEnd = (e) => {
    const shapeNode = e.target;
    const id = shapeNode.id();

    const updatedPages = pages.map(page => {
      if (page.id === currentPage) {
        const newShapes = page.shapes.map(s =>
          s.id === id
            ? { ...s, x: shapeNode.x(), y: shapeNode.y(), rotation: shapeNode.rotation() }
            : s
        );
        return { ...page, shapes: newShapes };
      }
      return page;
    });

    setPages(updatedPages);
    emitDrawUpdate(updatedPages);
  };

  const handleTransformEnd = (e) => {
    const node = e.target;
    const id = node.id();
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const rotation = node.rotation();

    // Reset scale on the node itself, new size/points are stored in state
    node.scaleX(1);
    node.scaleY(1);

    const updatedPages = pages.map(page => {
      if (page.id === currentPage) {
        const newShapes = page.shapes.map(shape => {
          if (shape.id === id) {
            let updatedShape = { ...shape };

            if (shape.type === 'line') {
                // For lines, transform the relative end point based on scale
                const points = shape.points || [0, 0, 0, 0];
                // Assume line points are relative [0, 0, endX, endY]
                const relativeEndX = points[2] || 0;
                const relativeEndY = points[3] || 0;
                const newRelativeEndX = relativeEndX * scaleX;
                const newRelativeEndY = relativeEndY * scaleY;

                updatedShape = {
                    ...shape,
                    x: node.x(), // New absolute position
                    y: node.y(),
                    points: [0, 0, newRelativeEndX, newRelativeEndY], // New relative points
                    rotation: rotation,
                    // Update width/height if used for bounding box calculations elsewhere
                    width: Math.abs(newRelativeEndX),
                    height: Math.abs(newRelativeEndY),
                };

            } else { // Rect, Ellipse, Image
              updatedShape = {
                ...shape,
                x: node.x(),
                y: node.y(),
                // Apply scale to dimensions, prevent zero/negative sizes
                width: Math.max(5, shape.width * scaleX),
                height: Math.max(5, shape.height * scaleY),
                rotation: rotation,
              };
            }
             return updatedShape;
          }
          return shape;
        });
        return { ...page, shapes: newShapes };
      }
      return page;
    });

    setPages(updatedPages);
    emitDrawUpdate(updatedPages);
  };

  const clearCanvas = () => {
    if (window.confirm("Are you sure you want to clear the current page?")) {
      const updatedPages = pages.map(page =>
        page.id === currentPage ? { ...page, lines: [], shapes: [] } : page
      );
      setPages(updatedPages);
      setSelectedId(null); // Deselect any selected item
      emitDrawUpdate(updatedPages);
    }
  };

  // --- Pagination Controls Component ---
  const PaginationControls = () => (
    <div style={{
      position: 'fixed',
      left: '50%', // Center horizontally
      bottom: 20,
      transform: 'translateX(-50%)',
      display: 'flex',
      gap: '10px',
      backgroundColor: 'rgba(240, 240, 240, 0.9)',
      padding: '8px 15px',
      borderRadius: '8px',
      boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
      zIndex: 10, // Ensure it's above the canvas
    }}>
      <button
        onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
        disabled={currentPage === 1}
        style={{ /* ... button styles ... */ }}
      >
        Prev
      </button>
      <span style={{ padding: '8px 10px', alignSelf: 'center', color: '#333' }}>
        Page {currentPage} / {pages.length}
      </span>
      <button
        onClick={() => setCurrentPage(Math.min(pages.length, currentPage + 1))}
        disabled={currentPage === pages.length}
        style={{ /* ... button styles ... */ }}
      >
        Next
      </button>
      <button
        onClick={() => {
          const newPageId = pages.length > 0 ? Math.max(...pages.map(p => p.id)) + 1 : 1;
          const newPage = { id: newPageId, lines: [], shapes: [] };
          const updatedPages = [...pages, newPage];
          setPages(updatedPages);
          setCurrentPage(newPage.id); // Go to the new page
          emitDrawUpdate(updatedPages); // Notify others about the new page structure
        }}
        style={{ marginLeft: '15px', /* ... button styles ... */ }}
      >
        Add Page
      </button>
    </div>
  );

  // --- Base Style for Toolbar Buttons ---
   const baseButtonStyle = {
     padding: 0, // Remove padding for image centering
     backgroundColor: 'white',
     border: '1px solid #ccc',
     borderRadius: '4px',
     cursor: 'pointer',
     display: 'flex',
     alignItems: 'center',
     justifyContent: 'center',
     width: '40px',
     height: '40px',
     boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
     transition: 'background-color 0.2s, box-shadow 0.2s',
   };

   const activeButtonStyle = {
     ...baseButtonStyle,
     backgroundColor: '#e0f0ff', // Highlight active tool
     borderColor: '#007bff',
   };

  // --- Render ---
  const currentPageData = pages.find(p => p.id === currentPage) || { lines: [], shapes: [] };

  return (
    <div className="whiteboard-container" style={{ height: '100vh', width: '100vw', overflow: 'hidden', position: 'relative', backgroundColor: '#f0f0f0' }}>
      {/* Toolbar */}
      <div style={{
        position: 'fixed',
        left: 15,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        backgroundColor: 'rgba(240, 240, 240, 0.9)',
        padding: '10px',
        borderRadius: '8px',
        boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
        zIndex: 10,
      }}>
        {/* Tool Buttons */}
        <button onClick={() => setTool('pen')} style={tool === 'pen' ? activeButtonStyle : baseButtonStyle} title="Pen">
          <img src={penIcon} alt="Pen" width="24" height="24" />
        </button>
        <button onClick={() => setTool('eraser')} style={tool === 'eraser' ? activeButtonStyle : baseButtonStyle} title="Eraser">
          <img src={eraserIcon} alt="Eraser" width="24" height="24" />
        </button>
        <button onClick={() => setTool('line')} style={tool === 'line' ? activeButtonStyle : baseButtonStyle} title="Line">
          <img src={lineIcon} alt="Line" width="24" height="24" />
        </button>
        <button onClick={() => setTool('rectangle')} style={tool === 'rectangle' ? activeButtonStyle : baseButtonStyle} title="Rectangle">
          <img src={rectangleIcon} alt="Rectangle" width="24" height="24" />
        </button>
        <button onClick={() => setTool('circle')} style={tool === 'circle' ? activeButtonStyle : baseButtonStyle} title="Circle">
          <img src={circleIcon} alt="Circle" width="24" height="24" />
        </button>
        <button onClick={() => setTool('select')} style={tool === 'select' ? activeButtonStyle : baseButtonStyle} title="Select/Transform">
          <img src={selectIcon} alt="Select" width="24" height="24" />
        </button>

        {/* Separator */}
        <hr style={{ width: '80%', margin: '10px auto', border: 'none', borderTop: '1px solid #ccc' }} />

        {/* Color Picker */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowColorPicker(!showColorPicker)}
            style={{ ...baseButtonStyle, backgroundColor: selectedColor }}
            title="Select Color"
          >
            <img src={colorPaletteIcon} alt="Color Palette" width="24" height="24" style={{ filter: 'invert(1) drop-shadow(0 0 1px black)' }}/>
          </button>
          {showColorPicker && (
            <div style={{
              position: 'absolute', top: 0, left: '110%', // Position to the right
              backgroundColor: 'white', border: '1px solid #ccc', padding: 8, zIndex: 11,
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, borderRadius: '4px', boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
            }}>
              {colors.map((color) => (
                <div
                  key={color}
                  style={{
                    width: 25, height: 25, backgroundColor: color, cursor: 'pointer',
                    border: '1px solid #ccc', borderRadius: '3px',
                  }}
                  onClick={() => { setSelectedColor(color); setShowColorPicker(false); }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Stroke Width Picker */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowStrokePicker(!showStrokePicker)}
            style={baseButtonStyle}
            title="Select Stroke Width"
          >
            {/* Visual indicator of current stroke width */}
            <div style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                 <div style={{ width: Math.min(16, selectedStrokeWidth), height: Math.min(16, selectedStrokeWidth), backgroundColor: 'black', borderRadius: '50%' }}/>
             </div>
          </button>
          {showStrokePicker && (
            <div style={{
               position: 'absolute', top: 0, left: '110%', // Position to the right
               backgroundColor: 'white', border: '1px solid #ccc', padding: 8, zIndex: 11,
               display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, borderRadius: '4px', boxShadow: '0 2px 5px rgba(0,0,0,0.2)', width: '150px'
            }}>
              {strokeWidths.map((width) => (
                <div
                  key={width}
                  style={{
                    width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: selectedStrokeWidth === width ? '2px solid #007bff' : '1px solid #eee',
                    borderRadius: '4px', padding: '2px', backgroundColor: selectedStrokeWidth === width ? '#e0f0ff' : 'transparent',
                  }}
                  onClick={() => { setSelectedStrokeWidth(width); setShowStrokePicker(false); }}
                >
                  <div style={{ width: Math.min(16, width), height: Math.min(16, width), backgroundColor: 'black', borderRadius: '50%' }}/>
                </div>
              ))}
            </div>
          )}
        </div>

         {/* Separator */}
         <hr style={{ width: '80%', margin: '10px auto', border: 'none', borderTop: '1px solid #ccc' }} />

        {/* Image Upload */}
        <div style={{ position: 'relative' }}>
          <input
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            style={{ opacity: 0, position: 'absolute', width: '100%', height: '100%', left: 0, top: 0, cursor: 'pointer', zIndex: 1 }}
            title="Upload Image"
          />
          <button style={baseButtonStyle} >
            <img src={imageIcon} alt="Upload Image" width="24" height="24" />
          </button>
        </div>

        {/* Clear Canvas */}
        <button onClick={clearCanvas} style={baseButtonStyle} title="Clear Current Page">
          <img src={clearIcon} alt="Clear Page" width="24" height="24" />
        </button>
      </div>

      {/* Konva Stage */}
      <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
            onClick={() => {
                // Close popovers if clicking outside toolbar
                setShowColorPicker(false);
                setShowStrokePicker(false);
            }}
      >
        <Stage
          ref={stageRef}
          width={window.innerWidth}
          height={window.innerHeight}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onTouchStart={handleMouseDown}
          onTouchMove={handleMouseMove}
          onTouchEnd={handleMouseUp}
          style={{ backgroundColor: 'white', touchAction: 'none' }} // touchAction: 'none' prevents browser default touch actions like scroll/zoom
        >
          {/* Layer for Shapes (Rect, Circle, Image, Lines drawn as shapes) */}
          <Layer>
            {currentPageData.shapes.map((shape) => {
              const isSelected = shape.id === selectedId && tool === 'select';
              const commonProps = {
                key: shape.id,
                id: shape.id,
                x: shape.x,
                y: shape.y,
                rotation: shape.rotation || 0,
                draggable: tool === 'select',
                onDragEnd: handleDragEnd,
                onTransformEnd: handleTransformEnd,
                onClick: () => tool === 'select' && setSelectedId(shape.id),
                 onTap: () => tool === 'select' && setSelectedId(shape.id), // For touch devices
                // Visual feedback for selection (optional)
                shadowColor: isSelected ? 'rgba(0, 123, 255, 0.7)' : undefined,
                shadowBlur: isSelected ? 10 : 0,
                shadowOpacity: isSelected ? 0.9 : 0,
              };

              switch (shape.type) {
                case 'image':
                  return shape.imageObj ? ( // Render only if imageObj is loaded
                    <Image
                      {...commonProps}
                      image={shape.imageObj}
                      width={shape.width}
                      height={shape.height}
                    />
                  ) : null; // Or a placeholder
                case 'line':
                     return (
                         <Line
                             {...commonProps}
                             points={shape.points}
                             stroke={shape.color}
                             strokeWidth={shape.strokeWidth}
                             lineCap="round"
                             lineJoin="round"
                             tension={0} // Straight line segments defined by points
                             perfectDrawEnabled={false} // Usually not needed for straight lines
                         />
                     );
                case 'rectangle':
                  return (
                    <Rect
                      {...commonProps}
                      width={shape.width}
                      height={shape.height}
                      stroke={shape.color}
                      strokeWidth={shape.strokeWidth}
                      fillEnabled={false} // Assuming only outline is desired
                    />
                  );
                case 'circle': // Use Ellipse for circles/ovals
                  return (
                    <Ellipse
                      {...commonProps}
                      // Konva Ellipse uses center x/y and radius x/y
                      x={shape.x + shape.width / 2}
                      y={shape.y + shape.height / 2}
                      radiusX={shape.width / 2}
                      radiusY={shape.height / 2}
                      stroke={shape.color}
                      strokeWidth={shape.strokeWidth}
                      fillEnabled={false} // Assuming only outline is desired
                    />
                  );
                default:
                  return null;
              }
            })}
          </Layer>

          {/* Layer for Freehand Drawing (Pen/Eraser) */}
          <Layer className="drawing-layer">
            {currentPageData.lines.map((line, i) => (
              <Line
                key={`line-${page.id}-${i}`} // Make key more specific if needed
                points={line.points}
                stroke={line.color}
                strokeWidth={line.strokeWidth}
                tension={line.tension !== undefined ? line.tension : 0.5}
                lineCap="round"
                lineJoin="round"
                globalCompositeOperation={line.globalCompositeOperation}
                listening={false} // Pen lines usually aren't selectable/draggable
                perfectDrawEnabled={false} // Can improve performance for complex lines
              />
            ))}
          </Layer>

          {/* Layer for Transformer */}
          <Layer>
            <Transformer
              ref={transformerRef}
              boundBoxFunc={(oldBox, newBox) => {
                // Minimum size constraint
                if (newBox.width < 5 || newBox.height < 5) {
                  return oldBox;
                }
                return newBox;
              }}
               // Keep aspect ratio for images by default? Shift+Resize usually handles this.
               // keepRatio={pages[currentPage - 1]?.shapes.find(s => s.id === selectedId)?.type === 'image'}
              rotateEnabled={true}
              resizeEnabled={true} // Enable resizing anchors
              anchorSize={10}
              anchorStroke="#007bff"
              anchorFill="#ffffff"
              anchorCornerRadius={3}
              borderStroke="#007bff"
              borderStrokeWidth={1}
              borderDash={[4, 4]}
              padding={3}
              ignoreStroke={true} // Transform based on shape bounds, not stroke width
              // Customize enabled anchors if needed
              // enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
            />
          </Layer>
        </Stage>
      </div>

      {/* Pagination Controls */}
      <PaginationControls />
    </div>
  );
};

export default Whiteboard;
