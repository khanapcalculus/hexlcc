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

  const colors = [
    '#000000', '#FF0000', '#00FF00', '#0000FF',
    '#FFFF00', '#FF00FF', '#00FFFF', '#800000',
    '#008000', '#000080', '#808000', '#800080',
    '#008080', '#808080', '#C0C0C0', '#FFFFFF'
  ];

  useEffect(() => {
    socket.on('draw-update', ({ lines, shapes }) => {
      setLines(lines);
      setShapes(shapes);
    });

    return () => {
      socket.off('draw-update');
    };
  }, []);

  useEffect(() => {
    if (selectedId) {
      const shape = shapes.find(s => s.id === selectedId);
      if (shape && transformerRef.current) {
        transformerRef.current.nodes([stageRef.current.findOne('#' + selectedId)]);
        transformerRef.current.getLayer().batchDraw();
      }
    }
  }, [selectedId, shapes]);

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
  
    if (tool === 'pen') {
      const newLine = {
        tool,
        points: [pos.x, pos.y],
        color: selectedColor,
        strokeWidth: selectedStrokeWidth,
        tension: 0.2,
        lineCap: 'round',
        lineJoin: 'round'
      };
      setLines([...lines, newLine]);
    } else if (tool === 'eraser') {
      const newLine = {
        tool,
        points: [pos.x, pos.y],
        color: '#ffffff',
        strokeWidth: selectedStrokeWidth * 2,
        tension: 0.2,
        lineCap: 'round',
        lineJoin: 'round'
      };
      setLines([...lines, newLine]);
    } else if (tool === 'select') {
      const clickedShape = e.target;
      if (clickedShape === e.target.getStage()) {
        setSelectedId(null);
        return;
      }
      if (clickedShape.getParent().className === 'Transformer') {
        return;
      }
      setSelectedId(clickedShape.id());
    }
  };

  const handleMouseMove = (e) => {
    if (!isDrawing) return;

    const pos = e.type.includes('touch') ?
      e.target.getStage().getPointerPosition() :
      e.target.getStage().getPointerPosition();

    if (!pos) return;

    if (tool === 'pen' || tool === 'eraser') {
      const lastLine = [...lines];
      const lastLineIndex = lastLine.length - 1;
      
      if (lastLineIndex >= 0) {
        lastLine[lastLineIndex].points = lastLine[lastLineIndex].points.concat([pos.x, pos.y]);
        setLines(lastLine);
        socket.emit('draw-update', { lines: lastLine, shapes });
      }
    } else if (tool === 'line') {
      const tempShapes = shapes.filter(shape => shape.id !== 'temp');
      const newShape = {
        id: 'temp',
        type: 'line',
        points: [startPos.x, startPos.y, pos.x, pos.y],
        color: selectedColor,
        strokeWidth: selectedStrokeWidth
      };
      const newShapes = [...tempShapes, newShape];
      setShapes(newShapes);
      // Add this line to emit shape preview
      socket.emit('draw-update', { lines, shapes: newShapes });
    } else if (['rectangle', 'circle'].includes(tool)) {
      const tempShapes = shapes.filter(shape => shape.id !== 'temp');
      const newShape = {
        id: 'temp',
        type: tool,
        x: Math.min(startPos.x, pos.x),
        y: Math.min(startPos.y, pos.y),
        width: Math.abs(pos.x - startPos.x),
        height: Math.abs(pos.y - startPos.y),
        color: selectedColor,
        strokeWidth: selectedStrokeWidth
      };
      const newShapes = [...tempShapes, newShape];
      setShapes(newShapes);
      // Add this line to emit shape preview
      socket.emit('draw-update', { lines, shapes: newShapes });
    }
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
    
    if (['line', 'rectangle', 'circle'].includes(tool)) {
      const tempShape = shapes.find(shape => shape.id === 'temp');
      if (tempShape) {
        const finalShape = {
          ...tempShape,
          id: Date.now().toString()
        };
        const newShapes = [...shapes.filter(shape => shape.id !== 'temp'), finalShape];
        setShapes(newShapes);
        socket.emit('draw-update', { lines, shapes: newShapes });
      }
    } else if (tool === 'pen' || tool === 'eraser') {
      socket.emit('draw-update', { lines, shapes });
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
      const img = new window.Image();
      
      img.onload = () => {
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
  
        // Calculate dimensions while maintaining aspect ratio
        let targetWidth = img.width;
        let targetHeight = img.height;
        
        // Maximum dimensions (adjust these values as needed)
        const MAX_WIDTH = 1200;
        const MAX_HEIGHT = 1200;
  
        // Scale down if image is too large
        if (targetWidth > MAX_WIDTH || targetHeight > MAX_HEIGHT) {
          if (targetWidth / targetHeight > MAX_WIDTH / MAX_HEIGHT) {
            targetWidth = MAX_WIDTH;
            targetHeight = (img.height * MAX_WIDTH) / img.width;
          } else {
            targetHeight = MAX_HEIGHT;
            targetWidth = (img.width * MAX_HEIGHT) / img.height;
          }
        }
  
        // Set canvas size and enable high-quality scaling
        tempCanvas.width = targetWidth;
        tempCanvas.height = targetHeight;
        
        // Enable image smoothing
        tempCtx.imageSmoothingEnabled = true;
        tempCtx.imageSmoothingQuality = 'high';
        
        // Draw image with better quality
        tempCtx.drawImage(img, 0, 0, targetWidth, targetHeight);
        
        // Get high-quality image data
        const processedImageData = tempCanvas.toDataURL('image/png', 1.0);
  
        const newShape = {
          id: Date.now().toString(),
          type: 'image',
          x: window.innerWidth / 4,
          y: window.innerHeight / 4,
          width: targetWidth,
          height: targetHeight,
          image: processedImageData,
          rotation: 0,
        };
  
        const newShapes = [...shapes, newShape];
        setShapes(newShapes);
        socket.emit('draw-update', { lines, shapes: newShapes });
      };
  
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const handleDragEnd = (e) => {
    const shape = e.target;
    const newShapes = shapes.map(s => {
      if (s.id === shape.id()) {
        if (s.type === 'circle') {
          return {
            ...s,
            x: shape.x() - s.width / 2,
            y: shape.y() - s.height / 2
          };
        }
        return {
          ...s,
          x: shape.x(),
          y: shape.y()
        };
      }
      return s;
    });
    setShapes(newShapes);
    socket.emit('draw-update', { lines, shapes: newShapes });
  };

  const handleTransformEnd = (e) => {
    const node = e.target;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    
    node.scaleX(1);
    node.scaleY(1);
    
    const newShapes = shapes.map(shape => 
      shape.id === node.id() ? {
        ...shape,
        x: node.x(),
        y: node.y(),
        width: Math.abs(node.width() * scaleX),
        height: Math.abs(node.height() * scaleY),
        rotation: node.rotation()
      } : shape
    );
    setShapes(newShapes);
    socket.emit('draw-update', { lines, shapes: newShapes });
  };

  return (
    <div className="whiteboard-container">
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
          onClick={() => {
            setLines([]);
            setShapes([]);
            socket.emit('draw-update', { lines: [], shapes: [] });
          }} 
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
        onContextMenu={e => e.evt.preventDefault()}
        listening={true}
        touchAction="none"
        style={{ touchAction: 'none' }}
      >
        <Layer>
          {/* First Layer: Background Elements */}
          <Image
            image={logoImage}
            x={window.innerWidth - 110} // 10px padding from right edge
            y={10}
            width={100}
            height={40}
            opacity={1}
          />

          {/* Second Layer: Shapes and Images */}
          {shapes.map((shape) => {
            if (shape.type === 'image') {
              const imageObj = new window.Image();
              imageObj.crossOrigin = 'anonymous';
              imageObj.src = shape.image;
              return (
                <Image
                  key={shape.id}
                  id={shape.id}
                  image={imageObj}
                  x={shape.x}
                  y={shape.y}
                  width={shape.width}
                  height={shape.height}
                  rotation={shape.rotation}
                  draggable={tool === 'select'}
                  onClick={() => tool === 'select' && setSelectedId(shape.id)}
                  onDragEnd={handleDragEnd}
                  onTransformEnd={handleTransformEnd}
                  globalCompositeOperation="source-over"
                />
              );
            } else if (shape.type === 'line') {
              return (
                <Line
                  key={shape.id}
                  id={shape.id}
                  points={shape.points || [
                    shape.x,
                    shape.y,
                    shape.x + shape.width,
                    shape.y + shape.height
                  ]}
                  stroke={shape.color}
                  strokeWidth={shape.strokeWidth}
                  draggable={tool === 'select'}
                  onClick={() => tool === 'select' && setSelectedId(shape.id)}
                  onDragEnd={handleDragEnd}
                  onTransformEnd={handleTransformEnd}
                />
              );
            } else if (shape.type === 'rectangle') {
              return (
                <Rect
                  key={shape.id}
                  id={shape.id}
                  x={shape.x}
                  y={shape.y}
                  width={shape.width}
                  height={shape.height}
                  stroke={shape.color}
                  strokeWidth={shape.strokeWidth}
                  draggable={tool === 'select'}
                  onClick={() => tool === 'select' && setSelectedId(shape.id)}
                  onDragEnd={handleDragEnd}
                  onTransformEnd={handleTransformEnd}
                />
              );
            } else if (shape.type === 'circle') {
              return (
                <Ellipse
                  key={shape.id}
                  id={shape.id}
                  x={shape.x + shape.width / 2}
                  y={shape.y + shape.height / 2}
                  radiusX={shape.width / 2}
                  radiusY={shape.height / 2}
                  stroke={shape.color}
                  strokeWidth={shape.strokeWidth}
                  draggable={tool === 'select'}
                  onClick={() => tool === 'select' && setSelectedId(shape.id)}
                  onDragEnd={handleDragEnd}
                  onTransformEnd={handleTransformEnd}
                />
              );
            }
            return null;
          })}

          {/* Third Layer: Drawing Lines and Eraser */}
          {lines.map((line, i) => (
            <Line
              key={i}
              points={line.points}
              stroke={line.color}
              strokeWidth={line.strokeWidth}
              tension={0.4}
              lineCap="round"
              lineJoin="round"
              globalCompositeOperation={
                line.tool === 'eraser' ? 'destination-out' : 'source-over'
              }
            />
          ))}

          {/* Top Layer: Selection Transform */}
          {selectedId && tool === 'select' && (
            <Transformer
              ref={transformerRef}
              boundBoxFunc={(oldBox, newBox) => {
                const isValid = newBox.width > 5 && newBox.height > 5;
                return isValid ? newBox : oldBox;
              }}
              rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
              enabledAnchors={[
                'top-left', 'top-center', 'top-right',
                'middle-left', 'middle-right',
                'bottom-left', 'bottom-center', 'bottom-right'
              ]}
              anchorSize={8}
              anchorCornerRadius={4}
              borderStroke="#00ff00"
              anchorStroke="#00ff00"
              anchorFill="#ffffff"
              padding={5}
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
};

export default Whiteboard;
