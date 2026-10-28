import Alpine from 'alpinejs';
import Compressor from 'compressorjs';
import JSZip from 'jszip';
import './style.css';

Alpine.data('imageCompressorApp', () => ({
    // متغیر اطلاعات فایل‌های اصلی
    originalFiles: [],

    // متغیر اطلاعات فایل‌های فشرده شده
    compressedFiles: [],

    isDragging: false,
    isZipping: false,
    debounceTimers: {},

    // شمارنده فایل‌های انتخاب‌شده
    get selectedCount() {
        return this.originalFiles.filter(f => f.selected).length;
    },

    get isAllSelected() {
        return this.originalFiles.length > 0 && this.selectedCount === this.originalFiles.length;
    },

    get isProcessingAny() {
        return this.compressedFiles.some(f => f.processing);
    },

    // محاسبات حجم برای فایل‌های انتخاب‌شده
    get selectedOriginalFiles() {
        return this.originalFiles.filter(f => f.selected);
    },

    get totalOriginalSize() {
        const list = this.selectedOriginalFiles.length > 0 ? this.selectedOriginalFiles : this.originalFiles;
        return list.reduce((acc, curr) => acc + curr.size, 0);
    },

    get totalCompressedSize() {
        const list = this.selectedOriginalFiles.length > 0 ? this.selectedOriginalFiles : this.originalFiles;
        const activeIds = new Set(list.map(f => f.id));
        return this.compressedFiles
            .filter(f => activeIds.has(f.id))
            .reduce((acc, curr) => acc + (curr.size || 0), 0);
    },

    get totalSavedPercent() {
        if (!this.totalOriginalSize || !this.totalCompressedSize) return 0;
        const diff = this.totalOriginalSize - this.totalCompressedSize;
        return Math.round((diff / this.totalOriginalSize) * 100);
    },

    getCompressed(id) {
        return this.compressedFiles.find(f => f.id === id);
    },

    // دریافت آدرس تصویر فشرده یا اصلی (جهت نمایش نسخه تغییرحجم‌یافته بدون پرش)
    getImagePreviewUrl(id) {
        const comp = this.getCompressed(id);
        if (comp && comp.previewUrl) {
            return comp.previewUrl;
        }
        const orig = this.originalFiles.find(f => f.id === id);
        return orig ? orig.previewUrl : '';
    },

    // رویدادهای درگ و دراپ
    handleDrop(e) {
        this.isDragging = false;
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (files.length) this.addFiles(files);
    },

    handleFileInput(e) {
        const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
        if (files.length) this.addFiles(files);
        e.target.value = '';
    },

    // افزودن فایل‌های جدید و محاسبه فشرده‌سازی منحصراً برای فایل‌های جدید
    async addFiles(files) {
        for (const file of files) {
            const id = 'img_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
            const previewUrl = URL.createObjectURL(file);
            const dims = await this.getImageDimensions(previewUrl);

            const origRecord = {
                id: id,
                file: file,
                name: file.name,
                size: file.size,
                type: file.type,
                width: dims.width,
                height: dims.height,
                previewUrl: previewUrl,
                quality: 80, // پیش‌فرض ۸۰٪
                selected: true // به صورت خودکار تیک‌خورده برای زیپ
            };

            this.originalFiles.push(origRecord);

            // ایجاد placeholder در فایل‌های فشرده شده
            const placeholder = {
                id: id,
                blob: null,
                name: file.name,
                size: file.size, // مقدار اولیه جهت ثبات نمایش
                width: dims.width,
                height: dims.height,
                previewUrl: previewUrl,
                percentSaved: 0,
                processing: true
            };
            this.compressedFiles.push(placeholder);

            // محاسبه فشرده‌سازی فقط برای این فایل اضافه شده
            this.compressSingle(origRecord);
        }
    },

    getImageDimensions(url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = () => resolve({ width: 0, height: 0 });
            img.src = url;
        });
    },

    // فشرده‌سازی یک تک‌فایل بر اساس کیفیت تنظیمی همان فایل
    compressSingle(origRecord) {
        const targetComp = this.compressedFiles.find(f => f.id === origRecord.id);
        if (targetComp) {
            targetComp.processing = true;
        }

        new Compressor(origRecord.file, {
            quality: origRecord.quality / 100, // گام ۱ به ۱
            checkOrientation: true,
            strict: true,
            success: async (resultBlob) => {
                const newPreviewUrl = URL.createObjectURL(resultBlob);
                const dims = await this.getImageDimensions(newPreviewUrl);
                const savedPercent = Math.round(((origRecord.size - resultBlob.size) / origRecord.size) * 100);

                const index = this.compressedFiles.findIndex(f => f.id === origRecord.id);
                if (index !== -1) {
                    const oldPreviewUrl = this.compressedFiles[index].previewUrl;

                    this.compressedFiles[index] = {
                        id: origRecord.id,
                        blob: resultBlob,
                        name: origRecord.name,
                        size: resultBlob.size,
                        type: resultBlob.type,
                        width: dims.width,
                        height: dims.height,
                        previewUrl: newPreviewUrl,
                        percentSaved: savedPercent,
                        processing: false
                    };

                    // آزادسازی آدرس URL قبلی با تاخیر جهت عدم پرش تصویر
                    if (oldPreviewUrl && oldPreviewUrl !== origRecord.previewUrl) {
                        setTimeout(() => URL.revokeObjectURL(oldPreviewUrl), 2000);
                    }
                }
            },
            error: (err) => {
                console.error('Compressor error:', err);
                const index = this.compressedFiles.findIndex(f => f.id === origRecord.id);
                if (index !== -1) {
                    this.compressedFiles[index].processing = false;
                }
            }
        });
    },

    // تغییر کیفیت یک فایل اختصاصی با Debounce
    onQualityChange(orig) {
        clearTimeout(this.debounceTimers[orig.id]);
        this.debounceTimers[orig.id] = setTimeout(() => {
            this.compressSingle(orig);
        }, 250);
    },

    // تغییر وضعیت انتخاب برای زیپ
    toggleSelect(orig) {
        orig.selected = !orig.selected;
    },

    // انتخاب همه یا لغو انتخاب
    toggleSelectAll() {
        const targetState = !this.isAllSelected;
        this.originalFiles.forEach(f => f.selected = targetState);
    },

    // حذف یک فایل
    removeFile(id) {
        const origIndex = this.originalFiles.findIndex(f => f.id === id);
        if (origIndex !== -1) {
            URL.revokeObjectURL(this.originalFiles[origIndex].previewUrl);
            this.originalFiles.splice(origIndex, 1);
        }

        const compIndex = this.compressedFiles.findIndex(f => f.id === id);
        if (compIndex !== -1) {
            if (this.compressedFiles[compIndex].previewUrl && this.compressedFiles[compIndex].previewUrl !== this.originalFiles[origIndex]?.previewUrl) {
                URL.revokeObjectURL(this.compressedFiles[compIndex].previewUrl);
            }
            this.compressedFiles.splice(compIndex, 1);
        }
    },

    // پاکسازی کامل
    clearAll() {
        this.originalFiles.forEach(f => URL.revokeObjectURL(f.previewUrl));
        this.compressedFiles.forEach(f => {
            if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
        });
        this.originalFiles = [];
        this.compressedFiles = [];
    },

    // دانلود تکی یک فایل (با دکمه امن در فوتر)
    downloadSingle(compressedItem) {
        if (!compressedItem || !compressedItem.blob) return;
        const url = URL.createObjectURL(compressedItem.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = compressedItem.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    // دانلود فایل‌های انتخاب‌شده به صورت ZIP
    async downloadSelectedAsZip() {
        const selectedOrigIds = new Set(this.originalFiles.filter(f => f.selected).map(f => f.id));
        const itemsToZip = this.compressedFiles.filter(c => selectedOrigIds.has(c.id) && c.blob);

        if (itemsToZip.length === 0 || this.isZipping) return;

        this.isZipping = true;
        try {
            const zip = new JSZip();
            itemsToZip.forEach(item => {
                zip.file(item.name, item.blob);
            });

            const content = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = `compressed_images_${Date.now()}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (err) {
            console.error('Error creating ZIP:', err);
            alert('متاسفانه در تولید فایل زیپ خطایی رخ داد.');
        } finally {
            this.isZipping = false;
        }
    },

    // نمایش خوانا و شیک بایت
    formatBytes(bytes, decimals = 1) {
        if (!bytes || bytes === 0) return '0 بایت';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        const val = parseFloat((bytes / Math.pow(k, i)).toFixed(dm));
        return val + ' ' + sizes[i];
    }
}));

window.Alpine = Alpine;
Alpine.start();
