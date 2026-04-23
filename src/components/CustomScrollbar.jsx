import { useEffect, useRef, useState } from "react";

export default function CustomScrollbar({
  visibleDomain,
  fullMin, fullMax,
  clampMin, clampMax,
  onScroll,
  visibleDomainRef,
}) {
  const trackRef = useRef(null);
  const [trackHeight, setTrackHeight] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Measure track height via ResizeObserver so thumb math stays in state,
  // never touching the ref during render (react-hooks/refs).
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setTrackHeight(entries[0]?.contentRect.height ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clampSpan = clampMax - clampMin;
  if (clampSpan <= 0) return null;

  const [vMin, vMax] = visibleDomain;
  const visSpan = Math.max(0, vMax - vMin);

  const thumbFrac = Math.min(1, visSpan / clampSpan);
  const thumbH = Math.max(20, thumbFrac * trackHeight);
  const availTrack = Math.max(0, trackHeight - thumbH);
  const thumbTop = clampSpan <= visSpan
    ? 0
    : Math.max(0, Math.min(availTrack, ((vMin - clampMin) / (clampSpan - visSpan)) * availTrack));

  const thumbBg = isDragging || isHovering
    ? "rgba(80, 80, 80, 0.65)"
    : "rgba(140, 140, 140, 0.45)";

  const handleThumbMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);

    const startClientY = e.clientY;
    const [startVMin, startVMax] = [...visibleDomainRef.current];
    const startSpan = startVMax - startVMin;

    const onMouseMove = (mv) => {
      const curThumbH = Math.max(20, Math.min(1, startSpan / clampSpan) * trackHeight);
      const agePerPx = (clampSpan - startSpan) / Math.max(1, trackHeight - curThumbH);
      const dy = mv.clientY - startClientY;
      const shift = dy * agePerPx;
      const newMin = Math.max(clampMin, Math.min(clampMax - startSpan, startVMin + shift));
      const newMax = newMin + startSpan;
      onScroll(newMin, newMax);
    };

    const onMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const handleTrackMouseDown = (e) => {
    // Only respond to clicks directly on the track background (not the thumb).
    if (e.target !== trackRef.current) return;
    e.preventDefault();
    const trackRect = trackRef.current.getBoundingClientRect();
    const clickY = e.clientY - trackRect.top;
    const isAboveThumb = clickY < thumbTop;
    const [curVMin, curVMax] = visibleDomainRef.current;
    const curSpan = curVMax - curVMin;
    const shift = curSpan * 0.9 * (isAboveThumb ? -1 : 1);
    const newMin = Math.max(clampMin, Math.min(clampMax - curSpan, curVMin + shift));
    const newMax = newMin + curSpan;
    onScroll(newMin, newMax);
  };

  // fullMin/fullMax reserved for future data-extent indicators.
  void fullMin; void fullMax;

  return (
    <div
      ref={trackRef}
      onMouseDown={handleTrackMouseDown}
      style={{
        position: "absolute",
        top: 0,
        right: 1,
        width: 12,
        height: "100%",
        background: "rgba(0,0,0,0.06)",
        cursor: "default",
        zIndex: 20,
        userSelect: "none",
        boxSizing: "border-box",
      }}
    >
      <div
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onMouseDown={handleThumbMouseDown}
        style={{
          position: "absolute",
          top: thumbTop,
          left: 1,
          right: 1,
          height: thumbH,
          background: thumbBg,
          borderRadius: 6,
          cursor: isDragging ? "grabbing" : "grab",
          transition: isDragging ? "none" : "background 0.1s",
        }}
      />
    </div>
  );
}
