import React, { useEffect, useRef, useState } from 'react';
import { Ellipse, Image, Layer, Line, Rect, Stage, Transformer } from 'react-konva';
import io from 'socket.io-client';
// Fix import paths to be within src directory
import circleIcon from '../assets/icons/circle.png';
import clearIcon from '../assets/icons/clear.png';
import eraserIcon from '../assets/icons/eraser.png';
import imageIcon from '../assets/icons/image.png';
import lineIcon from '../assets/icons/line.png';
import penIcon from '../assets/icons/pen.png';
import rectangleIcon from '../assets/icons/rectangle.png';
import selectIcon from '../assets/icons/select.png';
// Add logo import
import logo from '../assets/logo/logo.png';
// Add these imports at the top with other icon imports
import colorPaletteIcon from '../assets/icons/palette.png';

// Update Socket.IO connection to use environment variables or dynamic URL
const SOCKET_SERVER = process.env.REACT_APP_SOCKET_SERVER || window.location.origin;
const socket = io(SOCKET_SERVER, {
  transports: ['websocket', 'polling'],
  reconnectionDelay: 1000,
  reconnectionAttempts: 10,
  forceNew: true
});


const Whiteboard = () => {
  const [lines, setLines] = useState([]);
  const [shapes, setShapes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [tool, setTool] = useState('pen');
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [selectedColor, setSelectedColor] = useState('#000000');
  const [selectedStrokeWidth, setSelectedStrokeWidth] = useState(5);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showStrokePicker, setShowStrokePicker] = useState(false);
  const transformerRef = useRef();
  const stageRef = useRef();
  // Add state for logo
  const [logoImage] = useState(new window.Image());
  // Add these new state variables at the beginning of the Whiteboard component
  const [pages, setPages] = useState([{ id: 1, lines: [], shapes: [] }]);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_HEIGHT = window.innerHeight;
  const PAGE_GAP = 20; // Gap between pages

  const colors = [
    '#000000', '#FF0000', '#00FF00', '#0000FF',
    '#FFFF00', '#FF00FF', '#00FFFF', '#800000',
    '#008000', '#000080', '#808000', '#800080',
    '#008080', '#808080', '#C0C0C0', '#FFFFFF'
  ];

  // Single consolidated socket event handler
  useEffect(() => {
    // Handler for all drawing updates
    socket.on('draw-update', (data) => {
      if (data.pages) {
        // Recreate image objects for any image shapes
        const pagesWithImages = data.pages.map(page => ({
          ...page,
          shapes: page.shapes.map(shape => {
            if (shape.type === 'image' && shape.image) {
              const img = new window.Image();
              img.crossOrigin = 'anonymous';
              img.src = shape.image;
              return {
                ...shape,
                imageObj: img
              };
            }
            return shape;
          })
        }));
        setPages(pagesWithImages);
      }
    });

    return () => {
      socket.off('draw-update');
    };
  }, []);

  useEffect(() => {
    if (selectedId && pages[currentPage - 1]) {
      // Find shape in current page
      const shape = pages[currentPage - 1].shapes.find(s => s.id === selectedId);
      if (shape && transformerRef.current && stageRef.current) {
        // Get node by id from stage
        const node = stageRef.current.findOne('#' + selectedId);
        if (node) {
          // Attach node to transformer
          transformerRef.current.nodes([node]);

          // Force update the transformer
          transformerRef.current.getLayer().batchDraw();

          // Make sure transformer is visible and on top
          transformerRef.current.moveToTop();
          transformerRef.current.forceUpdate();
        }
      }
    }
  }, [selectedId, pages, currentPage]);

  // Add useEffect for logo loading
  useEffect(() => {
    logoImage.src = logo;
  }, [logoImage]);

  const handleMouseDown = (e) => {
    let pos;

    if (e.type === 'touchstart') {
      if (e.evt) {
        e.evt.preventDefault();
      }
      const touch = e.evt?.touches?.[0];
      if (touch) {
        const stage = e.target.getStage();
        pos = stage.getPointerPosition();
      }
    } else {
      pos = e.target.getStage().getPointerPosition();
    }

    if (!pos) return;

    setIsDrawing(true);
    setStartPos(pos);

    if (tool === 'pen' || tool === 'eraser') {
      const updatedPages = pages.map(page => {
        if (page.id === currentPage) {
          return {
            ...page,
            lines: [...page.lines, {
              tool,
              points: [pos.x, pos.y],
              color: selectedColor,
              strokeWidth: selectedStrokeWidth,
              tension: 0.2,
              lineCap: 'round',
              lineJoin: 'round'
            }]
          };
        }
        return page;
      });
      setPages(updatedPages);
      // Change from pages-update to draw-update for consistency
      socket.emit('draw-update', { pages: updatedPages });
    }

    if (tool === 'select') {
      const clickedShape = e.target;
      // Check if we clicked on empty stage
      if (clickedShape === e.target.getStage()) {
        setSelectedId(null);
        return;
      }
      // Ignore clicks on transformer
      if (clickedShape.getParent().className === 'Transformer') {
        return;
      }
      // Set selected id if shape is clicked
      if (clickedShape.id()) {
        setSelectedId(clickedShape.id());
      }
    }
  };

  const handleMouseMove = (e) => {
    if (!isDrawing) return;

    const pos = e.type.includes('touch') ?
      e.target.getStage().getPointerPosition() :
      e.target.getStage().getPointerPosition();

    if (!pos) return;

    if (tool === 'pen' || tool === 'eraser') {
      // Optimize pen/eraser by updating without full re-render
      const updatedPages = [...pages];
      const currentPageIndex = currentPage - 1;
      const lastLine = updatedPages[currentPageIndex].lines[updatedPages[currentPageIndex].lines.length - 1];

      if (lastLine) {
        lastLine.points = lastLine.points.concat([pos.x, pos.y]);
        setPages(updatedPages);

        // Only update the specific line in the layer to prevent flickering
        const layer = stageRef.current.findOne('.drawing-layer');
        if (layer) {
          const lines = layer.find('Line');
          if (lines && lines.length > 0) {
            const lastKonvaLine = lines[lines.length - 1];
            if (lastKonvaLine) {
              lastKonvaLine.points(lastLine.points);
              layer.batchDraw(); // More efficient than full redraw
            }
          }
        }

        // Throttle socket emissions to reduce network traffic - Increased to 16
        if (lastLine.points.length % 2 === 0) {
          socket.emit('draw-update', { pages: updatedPages });
        }
      }
    } else if (['line', 'rectangle', 'circle'].includes(tool)) {
      const updatedPages = [...pages];
      const currentPageIndex = currentPage - 1;

      // Remove previous temp shape
      updatedPages[currentPageIndex].shapes = updatedPages[currentPageIndex].shapes.filter(
        shape => shape.id !== 'temp'
      );

      // Add new temp shape with proper properties
      let newShape = {
        id: 'temp',
        type: tool,
        color: selectedColor,
        strokeWidth: selectedStrokeWidth
      };

      if (tool === 'line') {
        // For line, store the actual points
        newShape = {
          ...newShape,
          points: [startPos.x, startPos.y, pos.x, pos.y],
          x: 0,  // Lines use points directly, so x/y are 0
          y: 0,
          width: Math.abs(pos.x - startPos.x),  // Store width/height for transformer
          height: Math.abs(pos.y - startPos.y)
        };
      } else {
        // For rectangle and circle
        newShape = {
          ...newShape,
          x: Math.min(startPos.x, pos.x),
          y: Math.min(startPos.y, pos.y),
          width: Math.abs(pos.x - startPos.x),
          height: Math.abs(pos.y - startPos.y)
        };
      }

      updatedPages[currentPageIndex].shapes.push(newShape);
      setPages(updatedPages);
      socket.emit('draw-update', { pages: updatedPages });
    }
  };

  // Add this function to handle final draw update
  const handleDrawEnd = () => {
    if (tool === 'pen' || tool === 'eraser') {
      // Send final update when drawing stops
      socket.emit('draw-update', { pages });
    }
  };

  const handleMouseUp = (e) => {
    setIsDrawing(false);
    handleDrawEnd();

    if (['line', 'rectangle', 'circle'].includes(tool)) {
      const updatedPages = [...pages];
      const currentPageIndex = currentPage - 1;
      const tempShape = updatedPages[currentPageIndex].shapes.find(shape => shape.id === 'temp');

      if (tempShape) {
        // Remove temp shape and add final shape with a unique ID
        updatedPages[currentPageIndex].shapes = [
          ...updatedPages[currentPageIndex].shapes.filter(shape => shape.id !== 'temp'),
          { ...tempShape, id: Date.now().toString() }
        ];

        setPages(updatedPages);
        socket.emit('draw-update', { pages: updatedPages });
      }
    } else if (tool === 'pen' || tool === 'eraser') {
      socket.emit('draw-update', { pages });
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      // Create a new image object for loading
      const imageObj = new window.Image();
      imageObj.crossOrigin = 'anonymous';

      imageObj.onload = () => {
        // Calculate dimensions to maintain aspect ratio with max width of 500px
        let width = imageObj.width;
        let height = imageObj.height;

        if (width > 500) {
          const ratio = height / width;
          width = 500;
          height = width * ratio;
        }

        // Once image is loaded, add it to the canvas
        const newShape = {
          id: Date.now().toString(),
          type: 'image',
          x: window.innerWidth / 4,
          y: window.innerHeight / 4,
          width: width,
          height: height,
          imageObj: imageObj,
          image: reader.result // Store the base64 data
        };

        const updatedPages = pages.map(page => {
          if (page.id === currentPage) {
            return {
              ...page,
              shapes: [...page.shapes, newShape]
            };
          }
          return page;
        });

        setPages(updatedPages);
        socket.emit('draw-update', { pages: updatedPages });
      };

      // Set image source to trigger loading
      imageObj.src = reader.result;
    };

    reader.readAsDataURL(file);
  };

const handleDragEnd = (e) => {
  const shape = e.target;
  const updatedPages = pages.map(page => {
    if (page.id === currentPage) {
      const newShapes = page.shapes.map(s => {
        if (s.id === shape.id()) {
          return {
            ...s,
            x: shape.x(),
            y: shape.y(),
            rotation: shape.rotation()
          };
        }
        return s;
      });
      return {
        ...page,
        shapes: newShapes
      };
    }
    return page;
  });

  setPages(updatedPages);
  // Emit update immediately after state change
  socket.emit('draw-update', { pages: updatedPages });
};

const handleTransformEnd = (e) => {
  const node = e.target;
  const scaleX = node.scaleX();
  const scaleY = node.scaleY();
  const rotation = node.rotation();

  // Reset scale on the node
  node.scaleX(1);
  node.scaleY(1);

  const updatedPages = pages.map(page => {
    if (page.id === currentPage) {
      const newShapes = page.shapes.map(shape => {
        if (shape.id === node.id()) {
          if (shape.type === 'line') {
            // For lines, we need to transform the points
            const oldPoints = shape.points;
            if (oldPoints && oldPoints.length >= 4) {
              // Get the original line endpoints
              const x1 = oldPoints[0];
              const y1 = oldPoints[1];
              const x2 = oldPoints[2];
              const y2 = oldPoints[3];

              // Calculate new endpoints based on scale and rotation
              const dx = x2 - x1;
              const dy = y2 - y1;
              const newDx = dx * scaleX;
              const newDy = dy * scaleY;

              // Return updated line with new points
              return {
                ...shape,
                x: node.x(),
                y: node.y(),
                points: [0, 0, newDx, newDy],
                width: Math.abs(newDx),
                height: Math.abs(newDy),
                rotation: rotation
              };
            }
            return shape;
          } else {
            // For other shapes (rectangle, circle, image)
            return {
              ...shape,
              x: node.x(),
              y: node.y(),
              width: Math.max(5, Math.abs(node.width() * scaleX)),
              height: Math.max(5, Math.abs(node.height() * scaleY)),
              rotation: rotation
            };
          }
        }
        return shape;
      });
      return {
        ...page,
        shapes: newShapes
      };
    }
    return page;
  });

  setPages(updatedPages);
  socket.emit('draw-update', { pages: updatedPages });
};

  // Add clearCanvas function
  const clearCanvas = () => {
    const updatedPages = pages.map(page => {
      if (page.id === currentPage) {
        return {
          ...page,
          lines: [],
          shapes: []
        };
      }
      return page;
    });
    setPages(updatedPages);
    socket.emit('draw-update', { pages: updatedPages });
  };

  // Update PaginationControls component
  const PaginationControls = () => (
    <div style={{
      position: 'fixed',
      right: '50%',
      bottom: 20,
      transform: 'translateX(50%)',
      display: 'flex',
      gap: '10px',
      backgroundColor: 'rgba(255, 255, 255, 0.8)',
      padding: '10px',
      borderRadius: '8px',
      zIndex: 2,
    }}>
      <button
        onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
        disabled={currentPage === 1}
        style={{
          padding: '8px 16px',
          border: '1px solid #333',
          borderRadius: '4px',
          backgroundColor: 'white',
          cursor: currentPage === 1 ? 'default' : 'pointer',
          opacity: currentPage === 1 ? 0.5 : 1
        }}
      >
        Previous
      </button>
      <button
        onClick={() => {
          const newPage = {
            id: pages.length + 1,
            lines: [],
            shapes: []
          };
          const updatedPages = [...pages, newPage];
          setPages(updatedPages);
          setCurrentPage(updatedPages.length);
          socket.emit('draw-update', { pages: updatedPages }); // Changed from add-page to draw-update
        }}
        style={{
          padding: '8px 16px',
          border: '1px solid #333',
          borderRadius: '4px',
          backgroundColor: 'white',
          cursor: 'pointer'
        }}
      >
        Add Page
      </button>
      <button
        onClick={() => setCurrentPage(Math.min(pages.length, currentPage + 1))}
        disabled={currentPage === pages.length}
        style={{
          padding: '8px 16px',
          border: '1px solid #333',
          borderRadius: '4px',
          backgroundColor: 'white',
          cursor: currentPage === pages.length ? 'default' : 'pointer',
          opacity: currentPage === pages.length ? 0.5 : 1
        }}
      >
        Next
      </button>
      <span style={{ padding: '8px 16px' }}>
        Page {currentPage} of {pages.length}
      </span>
    </div>
  );

  // Update the container div to enable scrolling
  return (
    <div className="whiteboard-container" style={{ height: '100vh', overflow: 'hidden' }}>
      <div style={{
        position: 'fixed',
        left: 10,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        backgroundColor: 'rgba(255, 255, 255, 0.8)',
        padding: '10px',
        borderRadius: '8px',
        zIndex: 1,
      }}>
        <button
          onClick={() => setTool('pen')}
          style={{
            padding: 8,
            backgroundColor: 'transparent',
            border: '1px solid #333',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '40px',
            height: '40px'
          }}
        >
          <img src={penIcon} alt="Pen" width="24" height="24" />
        </button>
        {/* Apply the same style to other tool buttons */}
        <button onClick={() => setTool('eraser')} style={{ /* same button style */ }}>
          <img src={eraserIcon} alt="Eraser" width="24" height="24" />
        </button>
        <button onClick={() => setTool('line')} style={{ /* same button style */ }}>
          <img src={lineIcon} alt="Line" width="24" height="24" />
        </button>
        <button onClick={() => setTool('rectangle')} style={{ /* same button style */ }}>
          <img src={rectangleIcon} alt="Rectangle" width="24" height="24" />
        </button>
        <button onClick={() => setTool('circle')} style={{ /* same button style */ }}>
          <img src={circleIcon} alt="Circle" width="24" height="24" />
        </button>
        <button onClick={() => setTool('select')} style={{ /* same button style */ }}>
          <img src={selectIcon} alt="Select" width="24" height="24" />
        </button>

        {/* Color Picker */}
        <div style={{ display: 'inline-block', position: 'relative' }}>
          <button
            onClick={() => setShowColorPicker(!showColorPicker)}
            style={{
              width: '40px',
              height: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #333',
              borderRadius: '4px',
              backgroundColor: 'transparent',
              cursor: 'pointer'
            }}
          >
            <img src={colorPaletteIcon} alt="Color Palette" width="24" height="24"
              style={{
                filter: `drop-shadow(0 0 2px ${selectedColor})`,
                backgroundColor: 'transparent'
              }}
            />
          </button>
          {showColorPicker && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: '100%',
              backgroundColor: 'white',
              border: '1px solid #ccc',
              padding: 5,
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 5,
              zIndex: 2,
              marginLeft: '10px',
            }}>
              {colors.map((color, i) => (
                <div
                  key={i}
                  style={{
                    width: 25,
                    height: 25,
                    backgroundColor: color,
                    cursor: 'pointer',
                    border: '1px solid #ccc'
                  }}
                  onClick={() => {
                    setSelectedColor(color);
                    setShowColorPicker(false);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Stroke Width Picker */}
        <div style={{ display: 'inline-block', position: 'relative' }}>
          <button
            onClick={() => setShowStrokePicker(!showStrokePicker)}
            style={{
              width: '40px',
              height: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #333',
              borderRadius: '4px',
              backgroundColor: 'transparent',
              cursor: 'pointer'
            }}
          >
            <div style={{
              width: selectedStrokeWidth,
              height: selectedStrokeWidth,
              backgroundColor: selectedColor,
              borderRadius: '50%'
            }}/>
          </button>
          {showStrokePicker && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: '100%',
              backgroundColor: 'white',
              border: '1px solid #ccc',
              padding: '10px',
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '10px',
              zIndex: 2,
              marginLeft: '10px',
              width: '120px'
            }}>
              {Array.from({ length: 16 }, (_, i) => i + 1).map((width) => (
                <div
                  key={width}
                  style={{
                    width: '25px',
                    height: '25px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: selectedStrokeWidth === width ? '2px solid #00ff00' : '1px solid #ccc',
                    borderRadius: '4px',
                    padding: '2px'
                  }}
                  onClick={() => {
                    setSelectedStrokeWidth(width);
                    setShowStrokePicker(false);
                  }}
                >
                  <div style={{
                    width: width,
                    height: width,
                    backgroundColor: selectedColor,
                    borderRadius: '50%'
                  }}/>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Image Upload */}
        <div style={{ position: 'relative' }}>
          <input
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            style={{
              width: '40px',
              height: '40px',
              opacity: 0,
              position: 'absolute',
              left: 0,
              top: 0,
              cursor: 'pointer',
              zIndex: 1
            }}
          />
          <button style={{
            width: '40px',
            height: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid #333',
            borderRadius: '4px',
            backgroundColor: 'transparent',
            cursor: 'pointer'
          }}>
            <img src={imageIcon} alt="Upload Image" width="24" height="24" />
          </button>
        </div>

        <button
          onClick={clearCanvas}
          style={{
            width: '40px',
            height: '40px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid #333',
            borderRadius: '4px',
            backgroundColor: 'transparent',
            cursor: 'pointer'
          }}
        >
          <img src={clearIcon} alt="Clear All" width="24" height="24" />
        </button>
      </div>

      <div style={{
        height: '100%',
        width: '100%',
        position: 'relative'
      }}>
        {/* Only render current page */}
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
          style={{
            touchAction: 'none',
            backgroundColor: 'white'
          }}
        >
          {/* Bottom layer for shapes */}
          <Layer>
            {pages[currentPage - 1]?.shapes.map((shape) => (
              <React.Fragment key={shape.id}>
                {shape.type === 'image' && (
                  <Image
                    id={shape.id}
                    image={shape.imageObj}
                    x={shape.x}
                    y={shape.y}
                    width={shape.width}
                    height={shape.height}
                    rotation={shape.rotation || 0}
                    draggable={tool === 'select'}
                    onClick={() => tool === 'select' && setSelectedId(shape.id)}
                    onDragEnd={handleDragEnd}
                    onTransformEnd={handleTransformEnd}
                  />
                )}
                {shape.type === 'line' && (
                  <Line
                    id={shape.id}
                    points={shape.points}
                    stroke={shape.color}
                    strokeWidth={shape.strokeWidth}
                    x={shape.x || 0}
                    y={shape.y || 0}
                    rotation={shape.rotation || 0}
                    draggable={tool === 'select'}
                    onClick={() => tool === 'select' && setSelectedId(shape.id)}
                    onDragEnd={handleDragEnd}
                    onTransformEnd={handleTransformEnd}
                    perfectDrawEnabled={true}
                    tension={0}
                    lineCap="round"
                    lineJoin="round"
                  />
                )}
                {shape.type === 'rectangle' && (
                  <Rect
                    id={shape.id}
                    x={shape.x}
                    y={shape.y}
                    width={shape.width}
                    height={shape.height}
                    stroke={shape.color}
                    strokeWidth={shape.strokeWidth}
                    rotation={shape.rotation || 0}
                    fill="transparent"
                    draggable={tool === 'select'}
                    onClick={() => tool === 'select' && setSelectedId(shape.id)}
                    onDragEnd={handleDragEnd}
                    onTransformEnd={handleTransformEnd}
                  />
                )}
                {shape.type === 'circle' && (
                  <Ellipse
                    id={shape.id}
                    x={shape.x + shape.width / 2}
                    y={shape.y + shape.height / 2}
                    radiusX={shape.width / 2}
                    radiusY={shape.height / 2}
                    stroke={shape.color}
                    strokeWidth={shape.strokeWidth}
                    rotation={shape.rotation || 0}
                    fill="transparent"
                    draggable={tool === 'select'}
                    onClick={() => tool === 'select' && setSelectedId(shape.id)}
                    onDragEnd={handleDragEnd}
                    onTransformEnd={handleTransformEnd}
                  />
                )}
              </React.Fragment>
            ))}
          </Layer>

          {/* Middle layer for drawing with class name for reference */}
          <Layer className="drawing-layer">
            {pages[currentPage - 1]?.lines.map((line, i) => (
              <Line
                key={i}
                points={line.points}
                stroke={line.color}
                strokeWidth={line.strokeWidth}
                tension={0.3}  // Lower tension for smoother curves
                lineCap="round"
                lineJoin="round"
                globalCompositeOperation={
                  line.tool === 'eraser' ? 'destination-out' : 'source-over'
                }
                listening={false}  // Prevent interaction with lines
                perfectDrawEnabled={false}  // Improve performance
                hitStrokeWidth={0}  // Prevent hit detection on lines
              />
            ))}
          </Layer>

          {/* Top layer for selection */}
          <Layer>
            {selectedId && tool === 'select' && pages[currentPage - 1]?.shapes.find(s => s.id === selectedId) && (
              <Transformer
                ref={transformerRef}
                boundBoxFunc={(oldBox, newBox) => {
                  // Prevent negative width/height
                  if (newBox.width < 10 || newBox.height < 10) {
                    return oldBox;
                  }
                  return newBox;
                }}
                enabledAnchors={[
                  'top-left', 'top-center', 'top-right',
                  'middle-left', 'middle-right',
                  'bottom-left', 'bottom-center', 'bottom-right'
                ]}
                rotateEnabled={true}
                resizeEnabled={true}
                keepRatio={false}
                padding={5}
                anchorSize={10}
                anchorCornerRadius={4}
                borderStroke="#00a0ff"
                borderStrokeWidth={2}
                anchorStroke="#00a0ff"
                anchorFill="#ffffff"
                anchorStrokeWidth={2}
                borderDash={[3, 3]}
                centeredScaling={false}
                ignoreStroke={true}
              />
            )}
          </Layer>
        </Stage>
      </div>

      <PaginationControls />
    </div>
  );
};

export default Whiteboard;
