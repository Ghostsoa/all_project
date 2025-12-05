// 确认对话框组件

let confirmResolve = null;

// 显示确认对话框
export function showConfirm(message, title = '确认操作') {
    return new Promise((resolve) => {
        confirmResolve = resolve;
        
        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.id = 'confirmOverlay';
        
        // 创建对话框
        const dialog = document.createElement('div');
        dialog.className = 'confirm-dialog';
        dialog.innerHTML = `
            <div class="confirm-header">
                <h3 class="confirm-title">${escapeHtml(title)}</h3>
            </div>
            <div class="confirm-body">
                <p class="confirm-message">${escapeHtml(message)}</p>
            </div>
            <div class="confirm-footer">
                <button class="confirm-btn confirm-btn-cancel" onclick="window.closeConfirm(false)">
                    <i class="fa-solid fa-times"></i> 取消
                </button>
                <button class="confirm-btn confirm-btn-ok" onclick="window.closeConfirm(true)">
                    <i class="fa-solid fa-check"></i> 确定
                </button>
            </div>
        `;
        
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        
        // 淡入动画
        setTimeout(() => {
            overlay.classList.add('show');
        }, 10);
        
        // ESC键关闭
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                closeConfirm(false);
                document.removeEventListener('keydown', handleEsc);
            }
        };
        document.addEventListener('keydown', handleEsc);
    });
}

// 关闭确认对话框
window.closeConfirm = function(result) {
    const overlay = document.getElementById('confirmOverlay');
    if (!overlay) return;
    
    // 淡出动画
    overlay.classList.remove('show');
    
    setTimeout(() => {
        overlay.remove();
        if (confirmResolve) {
            confirmResolve(result);
            confirmResolve = null;
        }
    }, 200);
};

// HTML转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 初始化样式
const style = document.createElement('style');
style.textContent = `
/* 确认对话框遮罩 */
.confirm-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    opacity: 0;
    transition: opacity 0.2s ease;
}

.confirm-overlay.show {
    opacity: 1;
}

/* 确认对话框 */
.confirm-dialog {
    background: #1a1a1a;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    min-width: 320px;
    max-width: 500px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    animation: confirmSlideIn 0.2s ease;
}

@keyframes confirmSlideIn {
    from {
        transform: translateY(-20px) scale(0.95);
        opacity: 0;
    }
    to {
        transform: translateY(0) scale(1);
        opacity: 1;
    }
}

/* 头部 */
.confirm-header {
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.confirm-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: #ffffff;
}

/* 内容 */
.confirm-body {
    padding: 20px;
}

.confirm-message {
    margin: 0;
    font-size: 14px;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.8);
}

/* 底部按钮 */
.confirm-footer {
    padding: 12px 20px;
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.confirm-btn {
    padding: 8px 16px;
    border: none;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: all 0.2s ease;
    font-weight: 500;
}

.confirm-btn-cancel {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.2);
}

.confirm-btn-cancel:hover {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.3);
    transform: translateY(-1px);
}

.confirm-btn-ok {
    background: rgba(239, 68, 68, 0.2);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.5);
}

.confirm-btn-ok:hover {
    background: rgba(239, 68, 68, 0.3);
    border-color: #ef4444;
    transform: translateY(-1px);
}

.confirm-btn i {
    font-size: 12px;
}
`;
document.head.appendChild(style);
