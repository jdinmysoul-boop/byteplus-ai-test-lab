import { useState, useRef } from 'react';

const API_KEY = '160740fb-5b77-4dc8-aeec-0ee8a6c3d3e0';
const SEEDREAM_MODEL_ID = 'seedream-5-0-260128'; 
const SEEDANCE_MODEL_ID = 'seedance-1-5-pro-251215'; 

function App() {
  const [activeModel, setActiveModel] = useState('seedream');
  const [prompt, setPrompt] = useState('');
  const [imageRatio, setImageRatio] = useState('16:9');
  const [videoDuration, setVideoDuration] = useState('5'); 
  const [isLoading, setIsLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [progress, setProgress] = useState(0); 

  const [selectedImage, setSelectedImage] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 가능합니다.');
      return;
    }
    // Vercel 안정성을 위해 5MB 이하로 제한 권장
    if (file.size > 5 * 1024 * 1024) {
      alert('배포 환경의 안정성을 위해 5MB 이하 이미지를 권장합니다.');
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setSelectedImage(reader.result); 
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
  };

  const handleGenerate = async () => {
    if (!prompt.trim() && !selectedImage) return;
    setIsLoading(true);
    setResultUrl(null);
    setErrorMsg('');
    setProgress(0); 

    try {
      if (activeModel === 'seedream') await generateImage();
      else await generateVideo();
    } catch (error) {
      console.error("Generate Error Detail:", error);
      setErrorMsg(error.message || '요청 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const generateImage = async () => {
    const finalPrompt = `${prompt}, aspect ratio: ${imageRatio}`;
   const requestBody = {
      model: SEEDREAM_MODEL_ID,
      prompt: finalPrompt,
      size: "2K",
      output_format: "png",
      watermark: false
    };

    // 이미지 모델은 Base64 전체(설명 포함)를 잘 인식함
    if (selectedImage) requestBody.image = selectedImage;

    const response = await fetch('/api/v3/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) throw new Error(`이미지 생성 실패 (${response.status})`);
    const data = await response.json();
    setResultUrl(data.data[0].url);
  };

  const generateVideo = async () => {
    const finalPrompt = `${prompt} --duration ${videoDuration}`;
    const requestContent = [{ type: "text", text: finalPrompt }];
    
    if (selectedImage) {
      // 💡 핵심 수정: 동영상 API용으로 Base64에서 'data:image/...;base64,' 접두어를 제거함
      const pureBase64 = selectedImage.split(',')[1]; 
      requestContent.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${pureBase64}` } 
      });
    }

    const createRes = await fetch('/api/v3/contents/generations/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: SEEDANCE_MODEL_ID,
        content: requestContent
      })
    });

    if (!createRes.ok) {
      const errInfo = await createRes.json();
      throw new Error(`동영상 생성 실패: ${errInfo.error?.message || createRes.status}`);
    }
    
    const createData = await createRes.json();
    const taskId = createData.id || createData.data?.id;

    let isCompleted = false;
    let attempts = 0;
    while (!isCompleted && attempts < 100) {
      await new Promise(r => setTimeout(r, 4000));
      attempts++;
      setProgress(Math.min(98, attempts * 2));

      const checkRes = await fetch(`/api/v3/contents/generations/tasks/${taskId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${API_KEY}` }
      });

      if (!checkRes.ok) continue;
      const checkData = await checkRes.json();
      const taskInfo = checkData.data || checkData;
      const status = String(taskInfo.status || taskInfo.state || '').toLowerCase();

      if (status === 'succeed' || status === 'succeeded' || status === 'completed') {
        isCompleted = true;
        setProgress(100);
        const videoUrl = taskInfo.url || taskInfo.video_url || taskInfo.content?.video_url || taskInfo.result?.url;
        setTimeout(() => setResultUrl(videoUrl), 500);
        return;
      } else if (status === 'failed' || status === 'error') {
        throw new Error(`생성 실패: ${taskInfo.error?.message || '서버 오류'}`);
      }
    }
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}><h1 style={styles.title}>BytePlus AI 모델 테스트 랩</h1></header>
      <main style={styles.main}>
        <div style={styles.tabContainer}>
          <button style={activeModel === 'seedream' ? styles.activeTab : styles.tab} onClick={() => { setActiveModel('seedream'); setResultUrl(null); setErrorMsg(''); setSelectedImage(null); }}>이미지 생성 (Seedream 5.0)</button>
          <button style={activeModel === 'seedance' ? styles.activeTab : styles.tab} onClick={() => { setActiveModel('seedance'); setResultUrl(null); setErrorMsg(''); setSelectedImage(null); }}>동영상 생성 (Seedance 1.5 Pro)</button>
        </div>

        <div style={styles.resultArea}>
          {isLoading ? (
            <div style={styles.loadingContainer}>
              <div style={styles.spinner}></div>
              <p>{activeModel === 'seedream' ? "이미지 생성 중..." : `동영상 생성 중... (${progress}%)`}</p>
              {activeModel === 'seedance' && <div style={styles.progressBarBg}><div style={{...styles.progressBarFill, width: `${progress}%`}}></div></div>}
            </div>
          ) : resultUrl ? (
            activeModel === 'seedream' ? <img src={resultUrl} alt="Result" style={styles.media} /> : <video key={resultUrl} src={resultUrl} controls autoPlay loop playsInline style={styles.media} />
          ) : errorMsg ? (
            <p style={{color: '#ff6b6b'}}>{errorMsg}</p>
          ) : (
            <p style={styles.placeholder}>프롬프트나 이미지를 입력해 보세요.</p>
          )}
        </div>

        <div style={{...styles.inputArea, ...(isDragging ? styles.inputAreaDragging : {})}} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          <div style={styles.optionsContainer}>
          {activeModel === 'seedream' ? (
            <select value={imageRatio} onChange={(e) => setImageRatio(e.target.value)} style={styles.select}>
              <option value="1:1">1:1</option><option value="16:9">16:9</option><option value="9:16">9:16</option>
            </select>
          ) : (
            <select value={videoDuration} onChange={(e) => setVideoDuration(e.target.value)} style={styles.select}>
              <option value="5">5초</option><option value="10">10초</option>
            </select>
          )}
          {/* 👇 여기에 새로운 안내 문구가 추가되었습니다! */}
          <span style={styles.noticeText}>
            이 페이지는 테스트 용도로 제작되어 기능 제한이 있습니다.<br/>
            보다 다양한 기능을 직접 테스트해보고 싶으시다면 <a href="mailto:dh.jang@sharedit.co.kr" style={styles.mailLink}>dh.jang@sharedit.co.kr</a>로 연락 부탁드립니다.
          </span>
        </div>
          
          {selectedImage && <div style={styles.previewContainer}><img src={selectedImage} alt="Preview" style={styles.previewImage} /><button onClick={() => setSelectedImage(null)} style={styles.removePreviewBtn}>✕</button></div>}

          <div style={styles.promptContainer}>
            <input type="file" accept="image/*" ref={fileInputRef} style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files[0])} />
            <button onClick={() => fileInputRef.current.click()} style={styles.clipBtn}>📎</button>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="프롬프트를 입력하거나 이미지를 추가해서 콘텐츠를 생성해 보세요. " style={styles.textarea} />
            <button onClick={handleGenerate} disabled={isLoading || (!prompt.trim() && !selectedImage)} style={styles.generateBtn}>생성</button>
          </div>
        </div>
      </main>
    </div>
  );
}

const styles = {
  container: { minHeight: '100vh', backgroundColor: '#121212', color: '#e0e0e0', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column' },
  header: { padding: '20px', borderBottom: '1px solid #333', textAlign: 'center' },
  title: { margin: 0, fontSize: '24px' },
  main: { flex: 1, display: 'flex', flexDirection: 'column', maxWidth: '1200px', margin: '0 auto', width: '100%', padding: '20px' },
  tabContainer: { display: 'flex', gap: '10px', marginBottom: '20px', justifyContent: 'flex-end' },
  tab: { padding: '8px 16px', backgroundColor: '#2a2a2a', color: '#888', border: 'none', borderRadius: '8px', cursor: 'pointer' },
  activeTab: { padding: '8px 16px', backgroundColor: '#4a90e2', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold' },
  resultArea: { flex: 1, backgroundColor: '#1e1e1e', borderRadius: '12px', border: '1px solid #333', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '500px', marginBottom: '20px', padding: '20px' },
  placeholder: { color: '#666' },
  media: { maxWidth: '100%', maxHeight: '600px', borderRadius: '8px' },
  loadingContainer: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px', width: '100%', maxWidth: '300px' },
  spinner: { width: '40px', height: '40px', border: '4px solid #333', borderTop: '4px solid #4a90e2', borderRadius: '50%', animation: 'spin 1s linear infinite' },
  progressBarBg: { width: '100%', height: '8px', backgroundColor: '#333', borderRadius: '4px' },
  progressBarFill: { height: '100%', backgroundColor: '#4a90e2', transition: 'width 0.5s' },
  inputArea: { backgroundColor: '#1e1e1e', padding: '20px', borderRadius: '12px', border: '2px dashed transparent' },
  inputAreaDragging: { borderColor: '#4a90e2', backgroundColor: '#252525' },
  optionsContainer: { display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '10px' },
  select: { padding: '12px', backgroundColor: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: '4px' },
  previewContainer: { position: 'relative', display: 'inline-block', marginBottom: '15px' },
  previewImage: { height: '80px', borderRadius: '4px' },
  removePreviewBtn: { position: 'absolute', top: '5px', right: '5px', background: '#000', color: '#fff', border: 'none', borderRadius: '50%', width: '20px', height: '20px', cursor: 'pointer' },
  promptContainer: { display: 'flex', gap: '10px' },
  clipBtn: { padding: '0 20px', backgroundColor: '#2a2a2a', border: '1px solid #444', borderRadius: '8px', fontSize: '24px', cursor: 'pointer' },
  textarea: { flex: 1, minHeight: '80px', padding: '16px', backgroundColor: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: '8px', fontSize: '18px', fontFamily: 'inherit' },
  generateBtn: { padding: '0 32px', backgroundColor: '#4a90e2', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '24px', cursor: 'pointer' },
  noticeText: { color: '#888', fontSize: '13px', lineHeight: '1.4' },
  mailLink: { color: '#4a90e2', textDecoration: 'none', fontWeight: 'bold' }
};

const styleSheet = document.createElement("style");
styleSheet.innerText = `@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } } body { margin: 0; } * { box-sizing: border-box; }`;
document.head.appendChild(styleSheet);

export default App;