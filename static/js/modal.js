// 自定义模态对话框
export function showConfirm(message, title = '确认操作') {
    return new Promise((resolve) => {
        // 创建遮罩层
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        
        // 创建对话框
        const modal = document.createElement('div');
        modal.className = 'modal-dialog confirm-dialog';
        modal.innerHTML = `
            <div class="modal-header">
                <h3 class="modal-title">${title}</h3>
            </div>
            <div class="modal-body">
                <p class="modal-message">${message}</p>
            </div>
            <div class="modal-footer">
                <button class="modal-btn modal-btn-cancel">取消</button>
                <button class="modal-btn modal-btn-danger">确定</button>
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        // 显示动画
        setTimeout(() => {
            overlay.classList.add('show');
        }, 10);
        
        // 关闭对话框
        const close = (result) => {
            overlay.classList.remove('show');
            setTimeout(() => {
                overlay.remove();
                resolve(result);
            }, 200);
        };
        
        // 按钮事件
        const cancelBtn = modal.querySelector('.modal-btn-cancel');
        const confirmBtn = modal.querySelector('.modal-btn-danger');
        
        cancelBtn.addEventListener('click', () => close(false));
        confirmBtn.addEventListener('click', () => close(true));
        
        // ESC取消
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                close(false);
                document.removeEventListener('keydown', handleEsc);
            }
        };
        document.addEventListener('keydown', handleEsc);
        
        // 点击遮罩层取消
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                close(false);
            }
        });
        
        // 聚焦确定按钮
        confirmBtn.focus();
    });
}

export function showAlert(message, title = '提示') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        
        const modal = document.createElement('div');
        modal.className = 'modal-dialog alert-dialog';
        modal.innerHTML = `
            <div class="modal-header">
                <h3 class="modal-title">${title}</h3>
            </div>
            <div class="modal-body">
                <p class="modal-message">${message}</p>
            </div>
            <div class="modal-footer">
                <button class="modal-btn modal-btn-primary">确定</button>
            </div>
        `;
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        setTimeout(() => {
            overlay.classList.add('show');
        }, 10);
        
        const close = () => {
            overlay.classList.remove('show');
            setTimeout(() => {
                overlay.remove();
                resolve();
            }, 200);
        };
        
        const okBtn = modal.querySelector('.modal-btn-primary');
        okBtn.addEventListener('click', close);
        
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                close();
                document.removeEventListener('keydown', handleEsc);
            }
        };
        document.addEventListener('keydown', handleEsc);
        
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                close();
            }
        });
        
        okBtn.focus();
    });
}
