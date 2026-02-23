import { useState, useRef } from 'react';

const API_KEY = '160740fb-5b77-4dc8-aeec-0ee8a6c3d3e0';
const SEEDREAM_MODEL_ID = 'seedream-4-5-251128'; 
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

  // 💡 추가됨: 이미지 첨부 관련 상태 및 참조
  const [selectedImage, setSelectedImage] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // 💡 추가됨: 파일 선택 및 Base64 변환 로직
  const handleFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 업로드 가능합니다.');
      return;
    }
    // 30MB 이하 용량 제한 체크 (Seedance 권장사항)
    if (file.size > 30 * 1024 * 1024) {
      alert('30MB 이하의 이미지만 업로드 가능합니다.');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setSelectedImage(reader.result); // Base64 데이터로 저장
    };
    reader.readAsDataURL(file);
  };

  // 💡 추가됨: 드래그 앤 드롭 이벤트 핸들러
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim() && !selectedImage) return; // 프롬프트나 이미지 둘 중 하나는 있어야 함
    
    setIsLoading(true);
    setResultUrl(null);
    setErrorMsg('');
    setProgress(0); 

    try {
      if (activeModel === 'seedream') {
        await generateImage();
      } else {
        await generateVideo();
      }
    } catch (error) {
      console.error(error);
      setErrorMsg(error.message || '생성 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const generateImage = async () => {
    const finalPrompt = `${prompt}, aspect ratio: ${imageRatio}, resolution: 1920x1080px`;
    
    // 💡 수정됨: 이미지가 첨부되었다면 image 파라미터 추가
    const requestBody = {
      model: SEEDREAM_MODEL_ID,
      prompt: finalPrompt,
      sequential_image_generation: "disabled",
      response_format: "url",
      size: "2K", 
      stream: false,
      watermark: true
    };

    if (selectedImage) {
      requestBody.image = selectedImage; // Base64 이미지 추가
    }

    const response = await fetch('/api/v3/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) throw new Error(`이미지 API 호출 실패 (${response.status})`);
    
    const data = await response.json();
    if (data.data && data.data.length > 0) {
      setResultUrl(data.data[0].url);
    } else {
      throw new Error('결과 URL을 찾을 수 없습니다.');
    }
  };

  const generateVideo = async () => {
    const finalPrompt = `${prompt} --duration ${videoDuration}`;
    
    // 💡 수정됨: API 명세에 맞춰 content 배열에 텍스트와 이미지를 분리해서 담습니다.
    const requestContent = [{ type: "text", text: finalPrompt }];
    
    if (selectedImage) {
      requestContent.push({
        type: "image_url",
        image_url: { url: selectedImage }
      });
    }

    const createRes = await fetch('/api/v3/contents/generations/tasks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: SEEDANCE_MODEL_ID,
        content: requestContent
      })
    });

    if (!createRes.ok) {
        const errData = await createRes.json();
        throw new Error(`동영상 요청 거절됨 (${createRes.status})`);
    }
    
    const createData = await createRes.json();
    const taskId = createData.id || (createData.data && createData.data.id);
    
    if (!taskId) throw new Error('동영상 Task ID를 발급받지 못했습니다.');

    let isCompleted = false;
    let attempts = 0;
    const maxAttempts = 100; 

    while (!isCompleted && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 3000)); 
      attempts++;

      let fakeProgress = Math.min(98, attempts * 3);

      const checkRes = await fetch(`/api/v3/contents/generations/tasks/${taskId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        }
      });

      if (!checkRes.ok) {
        setProgress(fakeProgress); 
        continue;
      }

      const checkData = await checkRes.json();
      const taskInfo = checkData.data || checkData;
      const status = String(taskInfo.status || taskInfo.state || '').toLowerCase();
      
      let currentProgress = taskInfo.progress ?? checkData.progress;
      if (currentProgress !== undefined && currentProgress !== null) {
        let pct = Number(currentProgress);
        if (pct > 0 && pct <= 1 && String(pct).includes('.')) pct = Math.round(pct * 100);
        setProgress(pct);
      } else {
        setProgress(fakeProgress);
      }

      if (status === 'succeed' || status === 'succeeded' || status === 'completed' || status === 'success') {
        isCompleted = true;
        setProgress(100); 
        
        const videoUrl = taskInfo.url || taskInfo.video_url || (taskInfo.content && taskInfo.content.video_url) || (taskInfo.result && taskInfo.result.url);
        
        if (videoUrl) {
          setTimeout(() => setResultUrl(videoUrl), 500); 
        } else {
          throw new Error('생성은 완료되었으나, 응답에서 비디오 주소를 찾지 못했습니다.');
        }
        return;
      } else if (status === 'failed' || status === 'error') {
        const failReason = taskInfo.error?.message || taskInfo.failure_reason || taskInfo.message || '알 수 없는 이유';
        throw new Error(`동영상 생성 실패: ${failReason}`);
      }
    }

    if (!isCompleted) throw new Error('시간 초과 (5분)');
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>BytePlus AI 모델 테스트 랩</h1>
      </header>

      <main style={styles.main}>
        <div style={styles.tabContainer}>
          <button style={activeModel === 'seedream' ? styles.activeTab : styles.tab} onClick={() => { setActiveModel('seedream'); setResultUrl(null); setErrorMsg(''); setProgress(0); setSelectedImage(null); }}>이미지 생성 (Seedream 4.5)</button>
          <button style={activeModel === 'seedance' ? styles.activeTab : styles.tab} onClick={() => { setActiveModel('seedance'); setResultUrl(null); setErrorMsg(''); setProgress(0); setSelectedImage(null); }}>동영상 생성 (Seedance 1.5 Pro)</button>
        </div>

        <div style={styles.resultArea}>
          {isLoading ? (
            <div style={styles.loadingContainer}>
              <div style={styles.spinner}></div>
              <p style={styles.loadingText}>
                {activeModel === 'seedream' 
                  ? "Seedream 4.5가 이미지를 만들고 있습니다." 
                  : `Seedance 1.5 Pro가 동영상을 만들고 있습니다. (${progress}%)`}
              </p>
              {activeModel === 'seedance' && (
                <div style={styles.progressBarBg}>
                  <div style={{...styles.progressBarFill, width: `${progress}%`}}></div>
                </div>
              )}
            </div>
          ) : resultUrl ? (
            activeModel === 'seedream' ? (
              <img src={resultUrl} alt="Result" style={styles.media} />
            ) : (
              <video key={resultUrl} src={resultUrl} controls autoPlay loop playsInline style={styles.media} />
            )
          ) : errorMsg ? (
            <p style={{color: '#ff6b6b'}}>{errorMsg}</p>
          ) : (
            <p style={styles.placeholder}>프롬프트를 입력하거나 이미지를 첨부하여 생성을 시작해보세요.</p>
          )}
        </div>

        {/* 💡 수정됨: 드래그 앤 드롭을 감지하는 컨테이너 */}
        <div 
          style={{...styles.inputArea, ...(isDragging ? styles.inputAreaDragging : {})}}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div style={styles.optionsContainer}>
            {activeModel === 'seedream' ? (
              <select value={imageRatio} onChange={(e) => setImageRatio(e.target.value)} style={styles.select}>
                <option value="1:1">1:1 비율</option>
                <option value="16:9">16:9 비율</option>
                <option value="9:16">9:16 비율</option>
              </select>
            ) : (
              <select value={videoDuration} onChange={(e) => setVideoDuration(e.target.value)} style={styles.select}>
                <option value="5">5초 길이</option>
                <option value="10">10초 길이</option>
              </select>
            )}
          </div>
          
          {/* 💡 추가됨: 첨부된 이미지가 있을 경우 미리보기 영역 */}
          {selectedImage && (
            <div style={styles.previewContainer}>
              <img src={selectedImage} alt="첨부 미리보기" style={styles.previewImage} />
              <button onClick={() => setSelectedImage(null)} style={styles.removePreviewBtn}>✕</button>
            </div>
          )}

          <div style={styles.promptContainer}>
            {/* 💡 추가됨: 숨겨진 파일 입력창과 클립 버튼 */}
            <input 
              type="file" 
              accept="image/*" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              onChange={(e) => handleFile(e.target.files[0])} 
            />
            <button 
              onClick={() => fileInputRef.current.click()} 
              style={styles.clipBtn} 
              title="이미지 첨부"
            >
              📎
            </button>
            
            <textarea 
              value={prompt} 
              onChange={(e) => setPrompt(e.target.value)} 
              placeholder="장면을 묘사하거나 이미지를 여기에 드래그 앤 드롭 하세요." 
              style={styles.textarea} 
            />
            <button 
              onClick={handleGenerate} 
              disabled={isLoading || (!prompt.trim() && !selectedImage)} 
              style={styles.generateBtn}
            >
              생성
            </button>
          </div>
          <p style={styles.noticeText}>* 본 페이지는 BytePlus AI 모델 테스트용으로 일부 옵션이 고정되어 있습니다. (이미지는 드래그 앤 드롭으로 첨부 가능)</p>
        </div>
      </main>
    </div>
  );
}

const styles = {
  container: { minHeight: '100vh', backgroundColor: '#121212', color: '#e0e0e0', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column' },
  header: { padding: '20px', borderBottom: '1px solid #333', textAlign: 'center' },
  title: { margin: 0, fontSize: '24px', fontWeight: 'bold' },
  main: { flex: 1, display: 'flex', flexDirection: 'column', maxWidth: '1200px', margin: '0 auto', width: '100%', padding: '20px' },
  tabContainer: { display: 'flex', gap: '10px', marginBottom: '20px', justifyContent: 'flex-end' },
  tab: { padding: '8px 16px', backgroundColor: '#2a2a2a', color: '#888', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', transition: '0.2s' },
  activeTab: { padding: '8px 16px', backgroundColor: '#4a90e2', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' },
  resultArea: { flex: 1, backgroundColor: '#1e1e1e', borderRadius: '12px', border: '1px solid #333', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '500px', marginBottom: '20px', overflow: 'hidden', padding: '20px', textAlign: 'center' },
  placeholder: { color: '#666' },
  media: { maxWidth: '100%', maxHeight: '600px', objectFit: 'contain', borderRadius: '8px' },
  loadingContainer: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px', width: '100%', maxWidth: '300px' },
  spinner: { width: '40px', height: '40px', border: '4px solid #333', borderTop: '4px solid #4a90e2', borderRadius: '50%', animation: 'spin 1s linear infinite' },
  loadingText: { color: '#aaa', fontSize: '14px', lineHeight: '1.5', margin: '10px 0' },
  progressBarBg: { width: '100%', height: '8px', backgroundColor: '#333', borderRadius: '4px', overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#4a90e2', transition: 'width 0.5s ease-in-out' },
  inputArea: { backgroundColor: '#1e1e1e', padding: '20px', borderRadius: '12px', border: '2px dashed transparent', transition: 'border 0.3s ease' },
  inputAreaDragging: { borderColor: '#4a90e2', backgroundColor: '#252525' }, // 드래그 중일 때 하이라이트 효과
  optionsContainer: { marginBottom: '10px' },
  select: { padding: '12px 16px', backgroundColor: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: '4px', cursor: 'pointer', outline: 'none', fontSize: '16px' },
  
  // 💡 추가됨: 이미지 미리보기 스타일
  previewContainer: { position: 'relative', display: 'inline-block', marginBottom: '15px', padding: '10px', backgroundColor: '#2a2a2a', borderRadius: '8px' },
  previewImage: { height: '80px', borderRadius: '4px', objectFit: 'cover' },
  removePreviewBtn: { position: 'absolute', top: '5px', right: '5px', backgroundColor: 'rgba(0,0,0,0.7)', color: 'white', border: 'none', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' },
  
  promptContainer: { display: 'flex', gap: '10px', alignItems: 'flex-start' }, // 높이가 달라도 위로 정렬되게
  // 💡 추가됨: 클립 버튼 스타일
  clipBtn: { padding: '0 20px', height: '80px', backgroundColor: '#2a2a2a', border: '1px solid #444', borderRadius: '8px', cursor: 'pointer', fontSize: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: '0.2s' },
  textarea: { flex: 1, minHeight: '80px', padding: '16px', backgroundColor: '#2a2a2a', color: '#fff', border: '1px solid #444', borderRadius: '8px', resize: 'vertical', outline: 'none', fontSize: '18px', lineHeight: '1.5' },
  generateBtn: { padding: '0 32px', height: '80px', backgroundColor: '#4a90e2', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', whiteSpace: 'nowrap', fontSize: '24px' },
  noticeText: { marginTop: '15px', fontSize: '12px', color: '#666', lineHeight: '1.4' }
};

const styleSheet = document.createElement("style")
styleSheet.innerText = `
  @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  body { margin: 0; background-color: #121212; }
  * { box-sizing: border-box; }
`;
document.head.appendChild(styleSheet);

export default App;