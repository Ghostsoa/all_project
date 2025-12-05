// Toast通知组件

class Toast {
    constructor() {
        this.container = null;
        this.init();
    }

    init() {
        // 创建toast容器
        this.container = document.createElement('div');
        this.container.id = 'toastContainer';
        this.container.className = 'toast-container';
        document.body.appendChild(this.container);
    }

    /**
     * 显示toast提示
     * @param {string} message - 提示消息
     * @param {string} type - 类型：success, error, warning, info
     * @param {number} duration - 显示时长（毫秒）
     */
    show(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type} toast-enter`;
        
        // 图标映射
        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ'
        };
        
        toast.innerHTML = `
            <div class="toast-icon">${icons[type] || icons.info}</div>
            <div class="toast-message">${this.escapeHtml(message)}</div>
        `;
        
        this.container.appendChild(toast);
        
        // 触发动画
        requestAnimationFrame(() => {
            toast.classList.remove('toast-enter');
        });
        
        // 自动移除
        setTimeout(() => {
            this.remove(toast);
        }, duration);
        
        return toast;
    }

    remove(toast) {
        toast.classList.add('toast-exit');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 便捷方法
    success(message, duration) {
        return this.show(message, 'success', duration);
    }

    error(message, duration) {
        return this.show(message, 'error', duration);
    }

    warning(message, duration) {
        return this.show(message, 'warning', duration);
    }

    info(message, duration) {
        return this.show(message, 'info', duration);
    }
}

// 创建全局实例
const toast = new Toast();

// 导出便捷函数
export function showToast(message, type = 'info', duration = 3000) {
    return toast.show(message, type, duration);
}

export function successToast(message, duration) {
    return toast.success(message, duration);
}

export function errorToast(message, duration) {
    return toast.error(message, duration);
}

export function warningToast(message, duration) {
    return toast.warning(message, duration);
}

export function infoToast(message, duration) {
    return toast.info(message, duration);
}

// 暴露到全局（兼容旧代码）
window.showToast = showToast;
window.toast = toast;
