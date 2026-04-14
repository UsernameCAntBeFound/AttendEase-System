
        /* ----------------------------------------------------------------------------------------------------------------------------
           SESSION / AUTH
        ---------------------------------------------------------------------------------------------------------------------------- */
        const session = DB.requireAuth(['teacher']);
        if (!session) throw new Error('Not authenticated');

        /* ----------------------------------------------------------------------------------------------------------------------------
           STATE
        ---------------------------------------------------------------------------------------------------------------------------- */
        let teacherData = DB.getTeacherData(session.id);
        let currentClassCode = null;
        let currentDate = null;
        let currentSessionStudents = [];
        let currentExcuseIndex = null;
        let reportFormat = 'CSV';
        let qrTimerInterval = null;
        let chartInstances = {};
        let allPresentState = false;
        let previousStatuses = [];
        let currentStatusFilter = null;
        let editingClassCode = null;  // null = add mode, string = edit mode
        let newsAttachments = [];     // pending attachments for new announcement
        let selectedNewsClass = null;
        let attendanceMap = null;
        let mapMarkers = [];
        let autoRefreshInterval = null;

        /* ----------------------------------------------------------------------------------------------------------------------------
           INIT
        ---------------------------------------------------------------------------------------------------------------------------- */
        window.addEventListener('DOMContentLoaded', async () => {
            await window.initCloudDb();
            const fullName = `${session.firstname} ${session.lastname}`.trim();
            const initials = (session.firstname[0] + (session.lastname[0] || '')).toUpperCase();
            const el = document.getElementById('tName');
            const av = document.getElementById('tAvatar');
            if (el) el.textContent = fullName;
            if (av) av.textContent = initials;
            loadTeacherProfilePic();

            const today = new Date().toISOString().slice(0, 10);
            const defDate = (today >= '2026-04-12' && today <= '2026-04-18') ? today : '2026-04-12';
            document.getElementById('sessionDate').value = defDate;
            document.getElementById('qrDate').value = defDate;
            document.getElementById('rptFrom').value = '2026-04-12';
            document.getElementById('rptTo').value = '2026-04-18';

            populateClassDropdowns();
            currentClassCode = document.getElementById('classSelect').value;
            currentDate = '2026-04-12';
            loadAttendanceSession();
            renderReportPreview();
            renderClasses();
            renderNewsFeed();
            // initAttendanceMap(); // Move to navigate logic to ensure visibility

            const lastPage = sessionStorage.getItem('teacher_last_page');
            if (lastPage && document.getElementById('page-' + lastPage)) {
                navigate(lastPage);
            }

            // Expose for cloud-sync.js
            window.renderDashboard = () => {
                loadAttendanceSession();
            };

            // Listen for storage events (scans in other tabs)
            window.addEventListener('storage', (e) => {
                if (e.key && e.key.startsWith('attendease_')) {
                    loadAttendanceSession();
                }
            });
        });

        /** Populate all class dropdowns from teacher data */
        function populateClassDropdowns() {
            teacherData = DB.getTeacherData(session.id);
            const classes = teacherData.classes || [];

            // Attendance class selector
            const classSelect = document.getElementById('classSelect');
            classSelect.innerHTML = classes.map(c => `<option value="${c.code}">${c.name}</option>`).join('');

            // QR class selector
            const qrClass = document.getElementById('qrClass');
            qrClass.innerHTML = classes.map(c => `<option value="${c.code}">${c.name}</option>`).join('');

            // Report class selector
            const rptClass = document.getElementById('rptClass');
            rptClass.innerHTML = '<option value="ALL">All Subjects</option>' +
                classes.map(c => `<option value="${c.code}">${c.name}</option>`).join('');
        }

        /* ----------------------------------------------------------------------------------------------------------------------------
           NAVIGATION
        ---------------------------------------------------------------------------------------------------------------------------- */
        const PAGE_TITLES = { attendance: 'Attendance', qrcode: 'QR Code', news: 'News', reports: 'Reports', classes: 'Classes' };

        function navigate(page) {
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            document.getElementById('page-' + page).classList.add('active');
            document.getElementById('nav-' + page).classList.add('active');
            document.getElementById('pageTitle').textContent = PAGE_TITLES[page];
            document.getElementById('searchBox').style.display = page === 'attendance' ? '' : 'none';
            if (page === 'attendance') {
                initAttendanceMap(); // Ensure initialized at least once
                loadAttendanceSession();
                if (attendanceMap) setTimeout(() => attendanceMap.invalidateSize(), 100);
            }
            if (page === 'classes') { teacherData = DB.getTeacherData(session.id); renderClasses(); closeClassDetail(); }
            if (page === 'news') { renderNewsFeed(); renderNewsClassPills(); }

            // Persist last-visited tab so refresh stays on same page
            sessionStorage.setItem('teacher_last_page', page);
        }

        function toggleSidebar() {
            if (window.innerWidth > 900) {
                document.body.classList.toggle('sidebar-collapsed');
            } else {
                document.getElementById('sidebar').classList.toggle('open');
                document.getElementById('mainWrap').classList.toggle('shifted');
            }
        }

        /* ----------------------------------------------------------------------------------------------------------------------------
           ATTENDANCE  load / save session
        ---------------------------------------------------------------------------------------------------------------------------- */
        let _lastSessionHash = '';
        function loadAttendanceSession(forceRender = false) {
            currentClassCode = document.getElementById('classSelect').value;
            currentDate = document.getElementById('sessionDate').value;
            teacherData = DB.getTeacherData(session.id);
            allPresentState = false;
            previousStatuses = [];

            const sched = DB.schedules[currentClassCode];
            const badge = document.getElementById('schedBadge');
            if (badge) badge.innerHTML = sched ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg> Schedule: ${sched.display}` : '';

            const key = `${currentClassCode}_${currentDate}`;
            const savedRecords = teacherData.sessions[key]
                ? JSON.parse(JSON.stringify(teacherData.sessions[key]))
                : [];

            const recordMap = {};
            savedRecords.forEach(r => { recordMap[r.studentId] = true; });

            DB.getAll()
                .filter(u => u.role === 'student')
                .forEach(student => {
                    if (!recordMap[student.uid]) {
                        const dbRecord = (teacherData.sessions[key] || []).find(r => r.studentId === student.uid);
                        savedRecords.push({
                            studentId: student.uid,
                            name: `${student.firstname}`.trim(),
                            status: dbRecord ? dbRecord.status : 'absent',
                            timeIn: null,
                            timeOut: null,
                            remark: '',
                            excuse: dbRecord ? dbRecord.excuse || null : null,
                            excuseFileName: dbRecord ? dbRecord.excuseFileName || '' : '',
                            excuseSubmittedAt: dbRecord ? dbRecord.excuseSubmittedAt || '' : '',
                        });
        }
                });

        currentSessionStudents = savedRecords;
        const newHash = JSON.stringify(currentSessionStudents) + currentStatusFilter;
        if (forceRender === true || newHash !== _lastSessionHash) {
            renderStudentTable(filterStudentsData());
            _lastSessionHash = newHash;
            updateFilterChipStyles();
            updateMarkAllBtn();
        }
        }

        function saveAttendanceSession() {
            DB.saveSession_attendance(session.id, currentClassCode, currentDate, currentSessionStudents);
            teacherData = DB.getTeacherData(session.id);
        }

        function loadClass() { loadAttendanceSession(true); }

        function manualRefresh() {
            showToast(' Synchronizing data...');
            // Force a cloud check
            if (window.initCloudDb) {
                window.initCloudDb().then(() => {
                    loadAttendanceSession();
                    showToast(' Page Refreshed');
                });
            } else {
                loadAttendanceSession();
                showToast(' Page Refreshed');
            }
        }

        function renderStudentTable(list) {
            const tbody = document.getElementById('studentBody');
            tbody.innerHTML = '';
            if (!list.length) {
                tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;opacity:.5">No students in this session yet.</td></tr>`;
                updateStats();
                return;
            }
            list.forEach((s, i) => {
                // Find the real index in currentSessionStudents for this record
                const realIdx = currentSessionStudents.findIndex(r => r.studentId === s.studentId);
                tbody.innerHTML += `
        <tr id="row-${realIdx}" class="${s.status}">
            <td class="row-num">${i + 1}</td>
            <td class="student-name">${s.name}</td>
            <td class="student-id">${s.studentId}</td>
            <td>${s.timeIn ? `<span class="time-badge in">${s.timeIn}</span>` : '<span class="no-action"></span>'}</td>
            <td>${s.timeOut ? `<span class="time-badge out">${s.timeOut}</span>` : '<span class="no-action"></span>'}</td>
            <td>
                <div class="status-group">
                    <label class="status-radio present-radio ${s.status === 'present' ? 'active' : ''}">
                        <input type="radio" name="st-${realIdx}" value="present" ${s.status === 'present' ? 'checked' : ''} onchange="setStatus(${realIdx},'present')">Present
                    </label>
                    <label class="status-radio absent-radio ${s.status === 'absent' ? 'active' : ''}">
                        <input type="radio" name="st-${realIdx}" value="absent" ${s.status === 'absent' ? 'checked' : ''} onchange="setStatus(${realIdx},'absent')">Absent
                    </label>
                    <label class="status-radio" style="${s.status === 'late' ? 'background:rgba(249,115,22,.15);color:#f97316;border-color:#f97316' : ''}">
                        <input type="radio" name="st-${realIdx}" value="late" ${s.status === 'late' ? 'checked' : ''} onchange="setStatus(${realIdx},'late')">Late
                    </label>
                    <label class="status-radio excused-radio ${s.status === 'excused' ? 'active' : ''}">
                        <input type="radio" name="st-${realIdx}" value="excused" ${s.status === 'excused' ? 'checked' : ''} onchange="setStatus(${realIdx},'excused')">Excused
                    </label>
                </div>
            </td>
            <td>
                ${s.excuse
                        ? `<button class="attach-btn has-file" onclick="openExcuseModal(${realIdx})" title="View submitted excuse letter">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        \ud83d\udcc4 View
                    </button>`
                        : `<span class="no-action"></span>`}
            </td>
            <td><input class="remark-input" type="text" placeholder="Add note..." value="${s.remark || ''}" onchange="setRemark(${realIdx}, this.value)"></td>
            <td>${(s.status === 'absent' || s.status === 'late') ? `<button class="notify-btn" id="notify-btn-${realIdx}" onclick="notifyGuardian(${realIdx})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Notify</button>` : ''}</td>
        </tr>`;
            });
            updateStats();
            // Update map every time table renders
            updateAttendanceMap(currentSessionStudents);
        }

        function setStatus(idx, status) {
            currentSessionStudents[idx].status = status;
            // Only clear the excuse if there is no student-submitted letter attached.
            // Student-submitted letters have excuseSubmittedAt set; teacher-attached ones do not.
            if (status !== 'excused' && !currentSessionStudents[idx].excuseSubmittedAt) {
                currentSessionStudents[idx].excuse = null;
            }
            allPresentState = false;
            updateMarkAllBtn();
            saveAttendanceSession();
            renderStudentTable(filterStudentsData());
            updateStats();
        }

        function initAttendanceMap() {
            if (attendanceMap) return;
            const mapContainer = document.getElementById('attendanceMap');
            if (!mapContainer) return;

            // Default center (Manila coordinates as example)
            attendanceMap = L.map('attendanceMap', { zoomControl: false }).setView([14.5995, 120.9842], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap'
            }).addTo(attendanceMap);
            L.control.zoom({ position: 'bottomright' }).addTo(attendanceMap);
        }

        function updateAttendanceMap(records) {
            if (!attendanceMap) return;

            // Clear old markers
            mapMarkers.forEach(m => attendanceMap.removeLayer(m));
            mapMarkers = [];

            const locatedRecords = records.filter(r => r.location && r.location.lat && r.location.lng);
            document.getElementById('mapLocCount').textContent = `${locatedRecords.length} located`;

            if (!locatedRecords.length) return;

            const bounds = L.latLngBounds();
            locatedRecords.forEach(r => {
                const color = r.status === 'present' ? '#22c55e' : (r.status === 'late' ? '#f59e0b' : '#ef4444');
                const marker = L.circleMarker([r.location.lat, r.location.lng], {
                    radius: 7,
                    fillColor: color,
                    color: '#fff',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.9
                }).addTo(attendanceMap);

                marker.bindPopup(`
                    <div style="font-family:'Quicksand',sans-serif;padding:2px">
                        <strong style="display:block;margin-bottom:4px">${r.name}</strong>
                        <span class="chip ${r.status === 'present' ? 'green' : (r.status === 'late' ? 'yellow' : 'red')}" style="font-size:10px">${r.status.toUpperCase()}</span>
                        <div style="margin-top:6px;font-size:11px;color:#666">Time In: ${r.timeIn || ''}</div>
                    </div>
                `);

                mapMarkers.push(marker);
                bounds.extend([r.location.lat, r.location.lng]);
            });

            if (locatedRecords.length > 0) {
                attendanceMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
            }
        }

        function setRemark(idx, value) {
            currentSessionStudents[idx].remark = value;
            saveAttendanceSession();
        }

        function updateStats() {
            const list = currentSessionStudents;
            document.getElementById('presentCount').textContent = list.filter(s => s.status === 'present').length;
            document.getElementById('absentCount').textContent = list.filter(s => s.status === 'absent').length;
            document.getElementById('excusedCount').textContent = list.filter(s => s.status === 'excused').length;
            document.getElementById('lateCount').textContent = list.filter(s => s.status === 'late').length;
            document.getElementById('totalCount').textContent = list.length;
        }

        /*  Mark All Present / Undo  */
        function markAllPresent() {
            if (allPresentState) {
                // UNDO  restore previous statuses
                previousStatuses.forEach((saved, i) => {
                    if (currentSessionStudents[i]) {
                        currentSessionStudents[i].status = saved.status;
                        currentSessionStudents[i].excuse = saved.excuse;
                    }
                });
                allPresentState = false;
                saveAttendanceSession();
                renderStudentTable(filterStudentsData());
                showToast(' Action undone  statuses restored');
            } else {
                // MARK ALL  save current state first
                previousStatuses = currentSessionStudents.map(s => ({ status: s.status, excuse: s.excuse }));
                currentSessionStudents.forEach(s => { s.status = 'present'; s.excuse = null; });
                allPresentState = true;
                saveAttendanceSession();
                renderStudentTable(filterStudentsData());
                showToast('All students marked as Present  (click again to undo)');
            }
            updateMarkAllBtn();
        }

        function updateMarkAllBtn() {
            const btn = document.getElementById('markAllBtn');
            if (allPresentState) {
                btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l5-5m0 0l5 5M8 7v10"/></svg> Undo All Present`;
                btn.classList.add('undo-active');
            } else {
                btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> All Present`;
                btn.classList.remove('undo-active');
            }
        }

        /*  Clickable status filter chips  */
        function toggleStatusFilter(status) {
            if (currentStatusFilter === status) {
                currentStatusFilter = null; // unclick = show all
            } else {
                currentStatusFilter = status;
            }
            updateFilterChipStyles();
            renderStudentTable(filterStudentsData());
        }

        function updateFilterChipStyles() {
            ['present', 'absent', 'excused', 'late'].forEach(s => {
                const chip = document.getElementById('chip-' + s);
                if (chip) {
                    chip.classList.toggle('chip-active', currentStatusFilter === s);
                }
            });
        }

        function filterStudents() {
            renderStudentTable(filterStudentsData());
        }

        function filterStudentsData() {
            let list = currentSessionStudents;
            // Status filter from chips
            if (currentStatusFilter) {
                list = list.filter(s => s.status === currentStatusFilter);
            }
            // Search filter
            const q = document.getElementById('searchInput').value.toLowerCase();
            if (q) {
                list = list.filter(s => s.name.toLowerCase().includes(q) || s.studentId.includes(q));
            }
            return list;
        }

        /* ----------------------------------------------------------------------------------------------------------------------------
           EXCUSE LETTER VIEWER
        ---------------------------------------------------------------------------------------------------------------------------- */
        function openExcuseModal(idx) {
            const student = currentSessionStudents[idx];
            if (!student || !student.excuse) return; // no letter submitted  button shouldn't appear
            currentExcuseIndex = idx;

            // Student name
            document.getElementById('modalStudentName').textContent = '\ud83d\udcce ' + student.name;

            // Show image or PDF chip
            const imgWrap = document.getElementById('excuseViewImgWrap');
            const pdfWrap = document.getElementById('excuseViewPdfWrap');
            const isImage = student.excuse.startsWith('data:image/');

            if (isImage) {
                document.getElementById('excuseViewImg').src = student.excuse;
                imgWrap.hidden = false;
                pdfWrap.hidden = true;
            } else {
                document.getElementById('excuseViewPdfName').textContent =
                    student.excuseFileName || 'excuse_letter.pdf';
                imgWrap.hidden = true;
                pdfWrap.hidden = false;
            }

            // Submission timestamp
            const meta = document.getElementById('excuseViewMeta');
            meta.textContent = student.excuseSubmittedAt
                ? 'Submitted: ' + new Date(student.excuseSubmittedAt).toLocaleString('en-US',
                    { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : '';

            document.getElementById('excuseModal').hidden = false;
        }

        function openFullExcuseImage() {
            const student = currentSessionStudents[currentExcuseIndex];
            if (!student || !student.excuse) return;
            const viewer = document.getElementById('excuseViewerModal');
            document.getElementById('excuseViewerImg').src = student.excuse;
            document.getElementById('excuseViewerLabel').textContent = student.name;
            viewer.hidden = false;
        }

        function downloadCurrentExcuse() {
            const student = currentSessionStudents[currentExcuseIndex];
            if (!student || !student.excuse) return;
            const a = document.createElement('a');
            a.href = student.excuse;
            a.download = student.excuseFileName || 'excuse_letter';
            a.click();
        }

        function markExcused() {
            currentSessionStudents[currentExcuseIndex].status = 'excused';
            document.getElementById('excuseModal').hidden = true;
            saveAttendanceSession();
            renderStudentTable(filterStudentsData());
            showToast('Student marked as Excused ');
        }

        function closeExcuseModal(e) {
            if (!e || e.target === document.getElementById('excuseModal'))
                document.getElementById('excuseModal').hidden = true;
        }

        /* ----------------------------------------------------------------------------------------------------------------------------
           QR CODE
        ---------------------------------------------------------------------------------------------------------------------------- */
        function generateQR() {
            const cls = document.getElementById('qrClass').value;
            const date = document.getElementById('qrDate').value;
            const expiry = parseInt(document.getElementById('qrExpiry').value) || 15;

            if (!date || date < '2026-04-12' || date > '2026-04-18') {
                showToast(' Please select a date between April 12 and April 18, 2026.');
                return;
            }

            const payload = JSON.stringify({ cls, date, ts: Date.now(), exp: expiry });

            const container = document.getElementById('qrCanvas');
            container.innerHTML = '';
            new QRCode(container, {
                text: payload,
                width: 200, height: 200,
                colorDark: "#1e1b4b", colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H,
            });

            teacherData = DB.getTeacherData(session.id);
            const classObj = (teacherData.classes || []).find(c => c.code === cls);
            document.getElementById('qrMeta').innerHTML =
                `<strong>${classObj ? classObj.name : cls}</strong> &bull; ${date}`;

            document.getElementById('qrPlaceholder').hidden = true;
            document.getElementById('qrOutput').hidden = false;

            if (qrTimerInterval) clearInterval(qrTimerInterval);
            let remaining = expiry * 60;
            const timerEl = document.getElementById('qrTimer');
            const qrTick = () => {
                if (remaining <= 0) { clearInterval(qrTimerInterval); timerEl.textContent = 'QR Expired'; timerEl.style.color = 'var(--red)'; return; }
                const m = String(Math.floor(remaining / 60)).padStart(2, '0');
                const s = String(remaining % 60).padStart(2, '0');
                timerEl.textContent = `${m}:${s}`;
                remaining--;
            };
            qrTick();
            qrTimerInterval = setInterval(qrTick, 1000);
            showToast('QR Code generated ');
        }

        function downloadQR() {
            const img = document.querySelector('#qrCanvas img');
            if (!img) return;
            const a = document.createElement('a');
            a.href = img.src;
            a.download = 'attendease-qr.png';
            a.click();
        }

        /* ----------------------------------------------------------------------------------------------------------------------------
           NEWS / ANNOUNCEMENTS
        ---------------------------------------------------------------------------------------------------------------------------- */
        function renderNewsClassPills() {
            teacherData = DB.getTeacherData(session.id);
            const container = document.getElementById('newsClassPills');
            const classes = teacherData.classes || [];
            container.innerHTML = classes.map(c =>
                `<button class="news-pill ${selectedNewsClass === c.code ? 'active' : ''}" onclick="selectNewsClass('${c.code}')">${c.code}</button>`
            ).join('');
        }

        function selectNewsClass(code) {
            selectedNewsClass = selectedNewsClass === code ? null : code;
            renderNewsClassPills();
        }

        function formatText(command) {
            document.execCommand(command, false, null);
            document.getElementById('newsEditor').focus();
        }

        function handleNewsAttachments(event) {
            const files = Array.from(event.target.files);
            files.forEach(file => {
                const reader = new FileReader();
                reader.onload = ev => {
                    newsAttachments.push({
                        name: file.name,
                        dataUrl: ev.target.result,
                        type: file.type,
                    });
                    renderAttachmentPreviews();
                };
                reader.readAsDataURL(file);
            });
            event.target.value = '';
        }

        function renderAttachmentPreviews() {
            const container = document.getElementById('newsAttachmentPreview');
            container.innerHTML = newsAttachments.map((att, i) => {
                const isImage = att.type.startsWith('image/');
                return `<div class="attachment-chip">
                    ${isImage ? `<img src="${att.dataUrl}" class="att-thumb">` : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`}
                    <span>${att.name}</span>
                    <button class="att-remove" onclick="removeAttachment(${i})"></button>
                </div>`;
            }).join('');
        }

        function removeAttachment(idx) {
            newsAttachments.splice(idx, 1);
            renderAttachmentPreviews();
        }

        function postAnnouncement() {
            const editor = document.getElementById('newsEditor');
            const caption = editor.innerHTML.trim();

            if (!caption && newsAttachments.length === 0) {
                showToast(' Please write something or attach a file.');
                return;
            }
            if (!selectedNewsClass) {
                showToast(' Please choose a class for this announcement.');
                return;
            }

            teacherData = DB.getTeacherData(session.id);
            if (!teacherData.announcements) teacherData.announcements = [];

            //  Prevent accidental double-post via rapid button clicks 
            const postBtn = document.querySelector('[onclick*="postAnnouncement"]');
            if (postBtn) {
                if (postBtn.dataset.posting === '1') return;
                postBtn.dataset.posting = '1';
                const origHTML = postBtn.innerHTML;
                postBtn.innerHTML = ' Posting';
                postBtn.disabled = true;
                setTimeout(() => { postBtn.dataset.posting = ''; postBtn.innerHTML = origHTML; postBtn.disabled = false; }, 3000);
            }

            teacherData.announcements.unshift({
                id: Date.now(),
                classCode: selectedNewsClass,
                caption: caption,
                attachments: [...newsAttachments],
                createdAt: new Date().toISOString(),
            });

            DB.saveTeacherData(session.id, teacherData);

            // Notify enrolled students about the new announcement
            const postedClass = (teacherData.classes || []).find(c => c.code === selectedNewsClass);
            const className = postedClass ? postedClass.name : selectedNewsClass;
            const enrolledStudents = postedClass ? (postedClass.enrolledStudents || []) : [];
            const teacherFullName = `${session.firstname} ${session.lastname}`.trim();
            enrolledStudents.forEach(studentId => {
                pushStudentNotification(studentId, {
                    icon: '<span class="material-symbols-outlined" style="font-size:16px;vertical-align:middle;margin-right:4px;">news</span>',
                    title: `New announcement in ${className}`,
                    body: `${teacherFullName} posted a new announcement`,
                });
            });

            // Clear form
            editor.innerHTML = '';
            newsAttachments = [];
            renderAttachmentPreviews();
            selectedNewsClass = null;
            renderNewsClassPills();
            renderNewsFeed();
            showToast('Announcement posted ');
        }

        function renderNewsFeed() {
            teacherData = DB.getTeacherData(session.id);
            const feed = document.getElementById('newsFeed');
            const announcements = teacherData.announcements || [];

            if (!announcements.length) {
                feed.innerHTML = '<div class="empty-feed"><p>No announcements yet. Post one above!</p></div>';
                return;
            }

            const classMap = {};
            (teacherData.classes || []).forEach(c => { classMap[c.code] = c.name; });

            feed.innerHTML = announcements.map(a => {
                const date = new Date(a.createdAt);
                const timeStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
                    ' at ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

                const attachHTML = (a.attachments || []).map(att => {
                    const isImage = att.type && att.type.startsWith('image/');
                    return isImage
                        ? `<div class="feed-attachment">
                            <img src="${att.dataUrl}" class="feed-img" onclick="openAttachmentDownload('${att.dataUrl}', '${att.name}')">
                            <button class="download-btn" onclick="openAttachmentDownload('${att.dataUrl}', '${att.name}')">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                Download
                            </button>
                           </div>`
                        : `<div class="feed-file" onclick="openAttachmentDownload('${att.dataUrl}', '${att.name}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            <span>${att.name}</span>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                           </div>`;
                }).join('');

                return `<div class="news-card card">
                    <div class="news-card-top">
                        <span class="news-class-badge">${a.classCode}  ${classMap[a.classCode] || a.classCode}</span>
                        <div class="news-meta">
                            <span>${timeStr}</span>
                            <button class="news-delete" onclick="deleteAnnouncement(${a.id})" title="Delete">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            </button>
                        </div>
                    </div>
                    <div class="news-caption">${a.caption}</div>
                    ${attachHTML ? `<div class="news-attachments">${attachHTML}</div>` : ''}
                </div>`;
            }).join('');
        }

        function openAttachmentDownload(dataUrl, fileName) {
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = fileName;
            a.click();
        }

        function deleteAnnouncement(id) {
            teacherData = DB.getTeacherData(session.id);
            teacherData.announcements = (teacherData.announcements || []).filter(a => a.id !== id);
            DB.saveTeacherData(session.id, teacherData);
            renderNewsFeed();
            showToast('Announcement deleted');
        }

        /* ----------------------------------------------------------------------------------------------------------------------------
           REPORTS
        ---------------------------------------------------------------------------------------------------------------------------- */
        function renderReportPreview() {
            teacherData = DB.getTeacherData(session.id);
            const tbody = document.getElementById('reportPreviewBody');
            tbody.innerHTML = '';

            const classes = teacherData.classes || [];
            const CLASS_NAMES = {};
            classes.forEach(c => { CLASS_NAMES[c.code] = c.name; });
            const CLASS_ORDER = classes.map(c => c.code);

            const selectedCls = document.getElementById('rptClass').value;
            const fromDate = document.getElementById('rptFrom').value;
            const toDate = document.getElementById('rptTo').value;

            const clsMap = {};
            Object.entries(teacherData.sessions || {}).forEach(([key, records]) => {
                const [cls, date] = key.split('_');
                if (selectedCls !== 'ALL' && cls !== selectedCls) return;
                if (fromDate && date < fromDate) return;
                if (toDate && date > toDate) return;
                if (!clsMap[cls]) clsMap[cls] = {};
                records.forEach(r => {
                    if (!clsMap[cls][r.studentId])
                        clsMap[cls][r.studentId] = { name: r.name, id: r.studentId, present: 0, absent: 0, late: 0, excused: 0 };
                    const st = clsMap[cls][r.studentId];
                    if (r.status === 'present') st.present++;
                    else if (r.status === 'absent') st.absent++;
                    else if (r.status === 'late') st.late++;
                    else if (r.status === 'excused') st.excused++;
                });
            });

            const clsKeys = CLASS_ORDER.filter(c => (selectedCls === 'ALL' || c === selectedCls) && clsMap[c]);
            if (!clsKeys.length) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;opacity:.5">No attendance data for the selected filters.</td></tr>`;
                return;
            }

            clsKeys.forEach(cls => {
                tbody.innerHTML += `<tr style="background:rgba(99,102,241,.12)">
                    <td colspan="7" style="font-weight:700;color:var(--brand);padding:6px 10px;font-size:13px">
                        ${CLASS_NAMES[cls] || cls} &bull; <span style="font-weight:400;font-size:11px;opacity:.8">${DB.schedules[cls] ? DB.schedules[cls].display : ''}</span>
                    </td></tr>`;
                const students = Object.values(clsMap[cls]);
                students.forEach(s => {
                    const total = s.present + s.absent + s.late + s.excused || 1;
                    const rate = Math.round(((s.present + s.late) / total) * 100);
                    tbody.innerHTML += `<tr>
                        <td>${s.name}</td>
                        <td>${s.id}</td>
                        <td><span style="font-size:11px;opacity:.7">${CLASS_NAMES[cls] || cls}</span></td>
                        <td><span class="chip green">${s.present}</span></td>
                        <td><span class="chip red">${s.absent}</span></td>
                        <td><span class="chip yellow">${s.excused}</span></td>
                        <td><span class="chip ${rate >= 80 ? 'green' : rate >= 60 ? 'yellow' : 'red'}">${rate}%</span></td>
                    </tr>`;
                });
            });
        }

        function exportCSV() {
            teacherData = DB.getTeacherData(session.id);
            const classes = teacherData.classes || [];
            const CLASS_NAMES = {};
            classes.forEach(c => { CLASS_NAMES[c.code] = c.name; });
            const CLASS_ORDER = classes.map(c => c.code);
            const selectedCls = document.getElementById('rptClass').value;
            const fromDate = document.getElementById('rptFrom').value;
            const toDate = document.getElementById('rptTo').value;

            const clsMap = {};
            Object.entries(teacherData.sessions || {}).forEach(([key, records]) => {
                const [cls, date] = key.split('_');
                if (selectedCls !== 'ALL' && cls !== selectedCls) return;
                if (fromDate && date < fromDate) return;
                if (toDate && date > toDate) return;
                if (!clsMap[cls]) clsMap[cls] = {};
                records.forEach(r => {
                    if (!clsMap[cls][r.studentId])
                        clsMap[cls][r.studentId] = { name: r.name, id: r.studentId, present: 0, absent: 0, late: 0, excused: 0 };
                    const st = clsMap[cls][r.studentId];
                    if (r.status === 'present') st.present++;
                    else if (r.status === 'absent') st.absent++;
                    else if (r.status === 'late') st.late++;
                    else if (r.status === 'excused') st.excused++;
                });
            });

            const clsKeys = CLASS_ORDER.filter(c => (selectedCls === 'ALL' || c === selectedCls) && clsMap[c]);
            if (!clsKeys.length) { showToast('No data to export.'); return; }

            const q = v => `"${String(v).replace(/"/g, '""')}"`;
            const lines = [
                q('AttendEase - Attendance Report'),
                q('Period: ' + fromDate + ' to ' + toDate + '  |  Generated: ' + new Date().toLocaleDateString()),
                '',
                ['Subject', 'Student Name', 'Student ID', 'Present', 'Absent', 'Late', 'Excused', 'Attendance Rate'].map(q).join(','),
            ];

            clsKeys.forEach(cls => {
                Object.values(clsMap[cls]).forEach(s => {
                    const total = s.present + s.absent + s.late + s.excused || 1;
                    const rate = Math.round(((s.present + s.late) / total) * 100);
                    lines.push([CLASS_NAMES[cls] || cls, s.name, s.id, s.present, s.absent, s.late, s.excused, rate + '%'].map(q).join(','));
                });
                lines.push('');
            });

            const csv = lines.join('\n');
            const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'attendance_report.csv';
            a.click();
            showToast('CSV exported ');
        }

        function exportPDF() {
            var fromDate = document.getElementById('rptFrom').value;
            var toDate = document.getElementById('rptTo').value;
            if (!fromDate || !toDate || fromDate < '2026-04-12' || toDate > '2026-04-18' || fromDate > toDate) {
                showToast(' Report dates must be within April 1218, 2026.');
                return;
            }

            var jsPDF = window.jspdf.jsPDF;
            var doc = new jsPDF();

            teacherData = DB.getTeacherData(session.id);
            const classes = teacherData.classes || [];
            const CLASS_NAMES = {};
            classes.forEach(c => { CLASS_NAMES[c.code] = c.name; });
            const CLASS_ORDER = classes.map(c => c.code);
            var selectedCls = document.getElementById('rptClass').value;

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(16);
            doc.text('AttendEase - Attendance Report', 14, 18);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(9);
            doc.text('Period: ' + fromDate + ' to ' + toDate + '   |   Generated: ' + new Date().toLocaleDateString(), 14, 26);

            var clsMap = {};
            Object.entries(teacherData.sessions || {}).forEach(function ([key, records]) {
                var parts = key.split('_');
                var cls = parts[0]; var date = parts[1];
                if (selectedCls !== 'ALL' && cls !== selectedCls) return;
                if (date < fromDate || date > toDate) return;
                if (!clsMap[cls]) clsMap[cls] = {};
                records.forEach(function (r) {
                    if (!clsMap[cls][r.studentId])
                        clsMap[cls][r.studentId] = { name: r.name, id: r.studentId, present: 0, absent: 0, late: 0, excused: 0 };
                    var st = clsMap[cls][r.studentId];
                    if (r.status === 'present') st.present++;
                    else if (r.status === 'absent') st.absent++;
                    else if (r.status === 'late') st.late++;
                    else if (r.status === 'excused') st.excused++;
                });
            });

            var clsKeys = CLASS_ORDER.filter(function (c) { return (selectedCls === 'ALL' || c === selectedCls) && clsMap[c]; });
            if (!clsKeys.length) { showToast('No data to export.'); return; }

            var headers = ['Name', 'ID', 'Subject', 'Present', 'Absent', 'Late', 'Excused', 'Rate'];
            var colW = [52, 22, 22, 14, 14, 14, 14, 16];
            var y = 36;

            clsKeys.forEach(function (cls) {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(11);
                doc.text(CLASS_NAMES[cls] || cls, 14, y); y += 6;
                doc.setFontSize(8);
                var cx = 14;
                headers.forEach(function (h, i) { doc.text(h, cx, y); cx += colW[i]; });
                y += 4;
                doc.setLineWidth(0.2);
                doc.line(14, y, 196, y); y += 5;
                doc.setFont('helvetica', 'normal');

                Object.values(clsMap[cls]).forEach(function (s) {
                    var total = s.present + s.absent + s.late + s.excused || 1;
                    var rate = Math.round(((s.present + s.late) / total) * 100);
                    var row = [
                        s.name.substring(0, 24), s.id.substring(0, 12), (CLASS_NAMES[cls] || cls).substring(0, 10),
                        String(s.present), String(s.absent), String(s.late), String(s.excused), rate + '%'
                    ];
                    cx = 14;
                    row.forEach(function (v, i) { doc.text(v, cx, y); cx += colW[i]; });
                    y += 7;
                    if (y > 270) { doc.addPage(); y = 20; }
                });
                y += 4;
            });

            doc.save('attendance_report.pdf');
            showToast('PDF exported ');
        }

        function setFormat(fmt) {
            reportFormat = fmt;
            document.getElementById('fmtCSV').classList.toggle('active', fmt === 'CSV');
            document.getElementById('fmtPDF').classList.toggle('active', fmt === 'PDF');
        }

        function exportReport() {
            var fromDate = document.getElementById('rptFrom').value;
            var toDate = document.getElementById('rptTo').value;
            if (!fromDate || !toDate || fromDate < '2026-04-12' || toDate > '2026-04-18' || fromDate > toDate) {
                showToast(' Report dates must be within April 1218, 2026.');
                return;
            }
            if (reportFormat === 'CSV') exportCSV();
            else exportPDF();
        }

        /* ----------------------------------------------------------------------------------------------------------------------------
           CLASSES  Grid, Detail View, Add/Edit
        ---------------------------------------------------------------------------------------------------------------------------- */
        function renderClasses() {
            const grid = document.getElementById('classesGrid');
            grid.innerHTML = '';
            teacherData = DB.getTeacherData(session.id);
            const classes = teacherData.classes || [];

            if (!classes.length) {
                grid.innerHTML = `<p style="opacity:.5;padding:24px">No classes configured. Click "Add Class" to get started.</p>`;
                return;
            }

            const WEEK_DATES = ['2026-04-12', '2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17', '2026-04-18'];
            const WEEK_LABELS = ['Apr 12', 'Apr 13', 'Apr 14', 'Apr 15', 'Apr 16', 'Apr 17', 'Apr 18'];

            classes.forEach(cls => {
                const dailyRates = WEEK_DATES.map(date => {
                    const key = `${cls.code}_${date}`;
                    const records = (teacherData.sessions || {})[key];
                    if (!records || !records.length) return null;
                    const present = records.filter(r => r.status === 'present' || r.status === 'late').length;
                    return Math.round((present / records.length) * 100);
                });

                const validRates = dailyRates.filter(r => r !== null);
                const avg = validRates.length
                    ? Math.round(validRates.reduce((a, b) => a + b, 0) / validRates.length)
                    : 0;
                const color = avg >= 90 ? '#22c55e' : avg >= 75 ? '#f59e0b' : avg > 0 ? '#ef4444' : '#6366f1';

                const enrolledCount = (cls.enrolledStudents && cls.enrolledStudents.length > 0)
                    ? cls.enrolledStudents.length
                    : DB.getAll().filter(u => u.role === 'student').length;

                const div = document.createElement('div');
                div.className = 'class-analytics-card card clickable-card';
                div.onclick = () => openClassDetail(cls.code);
                div.innerHTML = `
            <div class="ca-header">
                <div>
                    <div class="ca-code">${cls.code}</div>
                    <div class="ca-name">${cls.name}</div>
                    <div class="ca-sched">${cls.schedule || 'No schedule set'} &bull; ${enrolledCount} students</div>
                </div>
                <div class="ca-rate" style="color:${color}">${avg > 0 ? avg + '%' : 'No data'}</div>
            </div>
            <div class="ca-bar-wrap">
                <div class="ca-bar-fill" style="width:${avg}%; background:${color}88;border-color:${color}"></div>
            </div>
            <div style="position:relative;height:110px;width:100%">
                <canvas id="chart-${cls.code}"></canvas>
            </div>
            <div class="ca-legend">
                <span class="legend-dot" style="background:${color}"></span>
                <span>Daily Attendance Rate (%) &mdash; Apr 12&ndash;18</span>
            </div>
        `;
                grid.appendChild(div);

                setTimeout(() => {
                    if (chartInstances[cls.code]) chartInstances[cls.code].destroy();
                    const canvasEl = document.getElementById('chart-' + cls.code);
                    if (!canvasEl) return;
                    const ctx = canvasEl.getContext('2d');
                    chartInstances[cls.code] = new Chart(ctx, {
                        type: 'line',
                        data: {
                            labels: WEEK_LABELS,
                            datasets: [{
                                data: dailyRates,
                                borderColor: color,
                                backgroundColor: color + '22',
                                borderWidth: 2.5,
                                pointRadius: dailyRates.map(r => r !== null ? 4 : 0),
                                pointBackgroundColor: color,
                                fill: true,
                                tension: 0.4,
                                spanGaps: false,
                            }]
                        },
                        options: {
                            responsive: true, maintainAspectRatio: false,
                            plugins: { legend: { display: false } },
                            scales: {
                                y: {
                                    min: 0, max: 100,
                                    grid: { color: 'rgba(99,102,241,0.07)' },
                                    ticks: { font: { size: 10 }, color: '#9ca3af', callback: v => v + '%' }
                                },
                                x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#9ca3af' } },
                            }
                        }
                    });
                }, 50);
            });
        }

        /*  Class Detail View  */
        function openClassDetail(classCode) {
            teacherData = DB.getTeacherData(session.id);
            const cls = (teacherData.classes || []).find(c => c.code === classCode);
            if (!cls) return;

            document.getElementById('classesViewGrid').style.display = 'none';
            document.getElementById('classDetailView').style.display = 'block';

            // Header
            const header = document.getElementById('detailHeader');
            header.innerHTML = `
                <div class="detail-header-content">
                    <div>
                        <span class="ca-code">${cls.code}</span>
                        <h2 class="detail-class-name">${cls.name}</h2>
                        <p class="detail-schedule">${cls.schedule || 'No schedule'}</p>
                    </div>
                    <div class="detail-actions">
                        <button class="btn-accent" onclick="openEditClassModal('${cls.code}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            Edit Class
                        </button>
                    </div>
                </div>
            `;

            // Stats
            const WEEK_DATES = ['2026-04-12', '2026-04-13', '2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17', '2026-04-18'];
            let totalPresent = 0, totalAbsent = 0, totalLate = 0, totalExcused = 0;
            const studentAttMap = {}; // studentId  { name, present, absent, late, excused }

            WEEK_DATES.forEach(date => {
                const key = `${classCode}_${date}`;
                const records = (teacherData.sessions || {})[key] || [];
                records.forEach(r => {
                    if (!studentAttMap[r.studentId]) {
                        studentAttMap[r.studentId] = { name: r.name, id: r.studentId, present: 0, absent: 0, late: 0, excused: 0 };
                    }
                    const s = studentAttMap[r.studentId];
                    if (r.status === 'present') { s.present++; totalPresent++; }
                    else if (r.status === 'absent') { s.absent++; totalAbsent++; }
                    else if (r.status === 'late') { s.late++; totalLate++; }
                    else if (r.status === 'excused') { s.excused++; totalExcused++; }
                });
            });

            const total = totalPresent + totalAbsent + totalLate + totalExcused;
            const rate = total > 0 ? Math.round(((totalPresent + totalLate) / total) * 100) : 0;

            document.getElementById('detailStats').innerHTML = `
                <div class="detail-stat-cards">
                    <div class="d-stat green"><span class="d-stat-num">${totalPresent}</span><span class="d-stat-label">Present</span></div>
                    <div class="d-stat red"><span class="d-stat-num">${totalAbsent}</span><span class="d-stat-label">Absent</span></div>
                    <div class="d-stat orange"><span class="d-stat-num">${totalLate}</span><span class="d-stat-label">Late</span></div>
                    <div class="d-stat yellow"><span class="d-stat-num">${totalExcused}</span><span class="d-stat-label">Excused</span></div>
                    <div class="d-stat blue"><span class="d-stat-num">${rate}%</span><span class="d-stat-label">Att. Rate</span></div>
                </div>
            `;

            // Student table
            const students = Object.values(studentAttMap);
            const tableDiv = document.getElementById('detailStudentTable');
            if (students.length === 0) {
                tableDiv.innerHTML = '<p style="padding:24px;text-align:center;opacity:.5">No attendance data for this class yet.</p>';
            } else {
                let rows = students.map((s, i) => {
                    const t = s.present + s.absent + s.late + s.excused || 1;
                    const r = Math.round(((s.present + s.late) / t) * 100);
                    return `<tr>
                        <td class="row-num">${i + 1}</td>
                        <td class="student-name">${s.name}</td>
                        <td class="student-id">${s.id}</td>
                        <td><span class="chip green">${s.present}</span></td>
                        <td><span class="chip red">${s.absent}</span></td>
                        <td><span class="chip" style="background:rgba(249,115,22,.12);color:#f97316">${s.late}</span></td>
                        <td><span class="chip yellow">${s.excused}</span></td>
                        <td><span class="chip ${r >= 80 ? 'green' : r >= 60 ? 'yellow' : 'red'}">${r}%</span></td>
                    </tr>`;
                }).join('');

                tableDiv.innerHTML = `<table class="student-table">
                    <thead><tr>
                        <th>#</th><th>Student Name</th><th>ID</th>
                        <th>Present</th><th>Absent</th><th>Late</th><th>Excused</th><th>Rate</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>`;
            }
        }

        function closeClassDetail() {
            document.getElementById('classesViewGrid').style.display = '';
            document.getElementById('classDetailView').style.display = 'none';
        }

        /*  Add / Edit Class Modal  */
        function openAddClassModal() {
            editingClassCode = null;
            document.getElementById('classModalTitle').textContent = 'Add New Class';
            document.getElementById('classCode').value = '';
            document.getElementById('classCode').disabled = false;
            document.getElementById('className').value = '';
            document.getElementById('classStartTime').value = '';
            document.getElementById('classEndTime').value = '';
            populateStudentPicker([]);
            document.getElementById('classModal').hidden = false;
        }

        function openEditClassModal(code) {
            editingClassCode = code;
            teacherData = DB.getTeacherData(session.id);
            const cls = (teacherData.classes || []).find(c => c.code === code);
            if (!cls) return;

            document.getElementById('classModalTitle').textContent = 'Edit Class  ' + cls.name;
            document.getElementById('classCode').value = cls.code;
            document.getElementById('classCode').disabled = true;
            document.getElementById('className').value = cls.name;
            document.getElementById('classStartTime').value = cls.scheduleStart || '';
            document.getElementById('classEndTime').value = cls.scheduleEnd || '';
            populateStudentPicker(cls.enrolledStudents || []);
            document.getElementById('classModal').hidden = false;
        }

        function closeClassModal(e) {
            if (!e || e.target === document.getElementById('classModal'))
                document.getElementById('classModal').hidden = true;
        }

        function populateStudentPicker(selectedIds) {
            const grouped = DB.getStudentsBySection();
            const sections = Object.keys(grouped).sort((a, b) => {
                if (a === 'No Section') return 1;
                if (b === 'No Section') return -1;
                return a.localeCompare(b);
            });

            // Populate section filter
            const filter = document.getElementById('sectionFilter');
            filter.innerHTML = '<option value="ALL">All Sections</option>' +
                sections.map(s => `<option value="${s}">${s}</option>`).join('');

            // Render student list
            const container = document.getElementById('studentPickerList');
            container.innerHTML = '';

            sections.forEach(section => {
                const sectionDiv = document.createElement('div');
                sectionDiv.className = 'picker-section';
                sectionDiv.dataset.section = section;
                sectionDiv.innerHTML = `<div class="picker-section-header">
                    <span>${section}</span>
                    <span class="section-count">${grouped[section].length} students</span>
                </div>`;

                grouped[section].forEach(student => {
                    const checked = selectedIds.includes(student.uid);
                    const item = document.createElement('label');
                    item.className = 'picker-student' + (checked ? ' checked' : '');
                    item.dataset.section = section;
                    item.innerHTML = `
                        <input type="checkbox" value="${student.uid}" ${checked ? 'checked' : ''} onchange="updatePickerCount()">
                        <span class="picker-name">${student.lastname}, ${student.firstname}</span>
                        <span class="picker-uid">${student.uid}</span>
                    `;
                    sectionDiv.appendChild(item);
                });

                container.appendChild(sectionDiv);
            });

            updatePickerCount();
        }

        function filterStudentPicker() {
            const section = document.getElementById('sectionFilter').value;
            document.querySelectorAll('.picker-section').forEach(el => {
                el.style.display = (section === 'ALL' || el.dataset.section === section) ? '' : 'none';
            });
        }

        function selectAllVisible() {
            const section = document.getElementById('sectionFilter').value;
            document.querySelectorAll('.picker-student').forEach(el => {
                if (section === 'ALL' || el.dataset.section === section) {
                    const cb = el.querySelector('input[type="checkbox"]');
                    cb.checked = true;
                    el.classList.add('checked');
                }
            });
            updatePickerCount();
        }

        function deselectAll() {
            document.querySelectorAll('.picker-student input[type="checkbox"]').forEach(cb => {
                cb.checked = false;
                cb.closest('.picker-student').classList.remove('checked');
            });
            updatePickerCount();
        }

        function updatePickerCount() {
            const count = document.querySelectorAll('.picker-student input:checked').length;
            document.getElementById('selectedCount').textContent = count + ' selected';
            // Update visual state
            document.querySelectorAll('.picker-student').forEach(el => {
                el.classList.toggle('checked', el.querySelector('input').checked);
            });
        }

        function saveClass() {
            const code = document.getElementById('classCode').value.trim().toUpperCase();
            const name = document.getElementById('className').value.trim();
            const startTime = document.getElementById('classStartTime').value;
            const endTime = document.getElementById('classEndTime').value;

            if (!code || !name) {
                showToast(' Class code and name are required.');
                return;
            }

            // Collect selected students
            const selectedStudents = [];
            document.querySelectorAll('.picker-student input:checked').forEach(cb => {
                selectedStudents.push(cb.value);
            });

            // Format schedule display
            let scheduleDisplay = '';
            if (startTime && endTime) {
                const fmt = t => {
                    const [h, m] = t.split(':').map(Number);
                    const ampm = h >= 12 ? 'PM' : 'AM';
                    const h12 = h % 12 || 12;
                    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
                };
                scheduleDisplay = `${fmt(startTime)}  ${fmt(endTime)}`;
            }

            teacherData = DB.getTeacherData(session.id);
            if (!teacherData.classes) teacherData.classes = [];

            if (editingClassCode) {
                // Edit existing
                const idx = teacherData.classes.findIndex(c => c.code === editingClassCode);
                if (idx >= 0) {
                    teacherData.classes[idx].name = name;
                    teacherData.classes[idx].schedule = scheduleDisplay;
                    teacherData.classes[idx].scheduleStart = startTime;
                    teacherData.classes[idx].scheduleEnd = endTime;
                    teacherData.classes[idx].enrolledStudents = selectedStudents;
                    teacherData.classes[idx].enrolled = selectedStudents.length;
                }
            } else {
                // Check for duplicate code
                if (teacherData.classes.some(c => c.code === code)) {
                    showToast(' A class with this code already exists.');
                    return;
                }
                teacherData.classes.push({
                    code,
                    name,
                    schedule: scheduleDisplay,
                    scheduleStart: startTime,
                    scheduleEnd: endTime,
                    enrolled: selectedStudents.length,
                    weekly: [0, 0, 0, 0, 0, 0, 0],
                    enrolledStudents: selectedStudents,
                });
            }

            DB.saveTeacherData(session.id, teacherData);

            // Notify newly added students
            const teacherFullName = `${session.firstname} ${session.lastname}`.trim();
            if (editingClassCode) {
                // Find students who weren't enrolled before but are now
                const oldClass = (DB.getTeacherData(session.id).classes || []).find(c => c.code === editingClassCode);
                const oldEnrolled = new Set((oldClass ? oldClass.enrolledStudents : []) || []);
                selectedStudents.forEach(studentId => {
                    if (!oldEnrolled.has(studentId)) {
                        pushStudentNotification(studentId, {
                            icon: '',
                            title: `Added to ${name}`,
                            body: `${teacherFullName} added you to ${name} (${code})`,
                        });
                    }
                });
            } else {
                // New class  notify all selected students
                selectedStudents.forEach(studentId => {
                    pushStudentNotification(studentId, {
                        icon: '',
                        title: `Added to ${name}`,
                        body: `${teacherFullName} added you to ${name} (${code})`,
                    });
                });
            }

            document.getElementById('classModal').hidden = true;
            populateClassDropdowns();
            renderClasses();
            showToast(editingClassCode ? 'Class updated ' : 'Class added ');
        }


        /* ----------------------------------------------------------------------------------------------------------------------------
           GEOLOCATION MAP  (Leaflet + OpenStreetMap/CARTO)
        ---------------------------------------------------------------------------------------------------------------------------- */
        let _leafletMap = null;
        let _mapMarkers = [];

        const STATUS_COLORS = {
            present: '#22c55e',
            late: '#f97316',
            absent: '#ef4444',
            excused: '#f59e0b',
        };

        function initAttendanceMap() {
            if (_leafletMap) return;
            _leafletMap = L.map('attendanceMap', { zoomControl: true })
                .setView([14.5995, 120.9842], 13);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
                subdomains: 'abcd',
                maxZoom: 19
            }).addTo(_leafletMap);
        }

        function updateAttendanceMap(students) {
            initAttendanceMap();
            _mapMarkers.forEach(m => _leafletMap.removeLayer(m));
            _mapMarkers = [];

            const located = students.filter(s => s.location && s.location.lat);
            document.getElementById('mapLocCount').textContent = located.length + ' located';

            if (!located.length) return;

            const bounds = [];
            located.forEach(s => {
                const color = STATUS_COLORS[s.status] || '#6366f1';
                const initials = (s.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
                const iconHtml = `<div class="map-pin" style="background:${color}" title="${s.name}"><span>${initials}</span></div>`;
                const icon = L.divIcon({ className: '', html: iconHtml, iconSize: [34, 34], iconAnchor: [17, 34] });

                const popup = `<div class="map-popup">
                    <strong>${s.name}</strong>
                    <span class="mp-status mp-${s.status}">${s.status}</span>
                    <span>Time In: ${s.timeIn || ''}</span>
                    <span>ID: ${s.studentId}</span>
                </div>`;

                const marker = L.marker([s.location.lat, s.location.lng], { icon })
                    .bindPopup(popup, { minWidth: 160 });
                marker.addTo(_leafletMap);
                _mapMarkers.push(marker);
                bounds.push([s.location.lat, s.location.lng]);
            });

            if (bounds.length === 1) {
                _leafletMap.setView(bounds[0], 16);
            } else {
                _leafletMap.fitBounds(bounds, { padding: [30, 30] });
            }
            setTimeout(() => _leafletMap.invalidateSize(), 100);
        }

        /* 
           GUARDIAN MESSENGER NOTIFICATIONS
         */
        const CLASS_NAMES_MAP = { ENG: 'English', AP: 'Araling Panlipunan', MATH: 'Mathematics', SCI: 'Science' };
        const MCP_URL = 'https://attendease-messenger.onrender.com';

        async function notifyGuardian(idx) {
            const s = currentSessionStudents[idx];
            const btn = document.getElementById('notify-btn-' + idx);
            if (!btn) return;
            btn.disabled = true;
            btn.textContent = ' Sending...';
            btn.className = 'notify-btn sending';

            // Try to look up the student's saved guardian FB link from DB
            let guardianContact = '';
            try {
                const allUsers = DB.getAll();
                const studentUser = allUsers.find(u => u.role === 'student' && u.uid === s.studentId);
                if (studentUser) {
                    const sd = DB.getStudentData(studentUser.id);
                    guardianContact = sd.guardianFbLink || '';
                }
            } catch (_) { }

            try {
                const res = await fetch(MCP_URL + '/api/notify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        studentId: s.studentId,
                        studentName: s.name,
                        status: s.status,
                        className: CLASS_NAMES_MAP[currentClassCode] || currentClassCode,
                        date: currentDate,
                        remark: s.remark || '',
                        guardianContact   // pass FB link so MCP can register it if no PSID yet
                    })
                });
                const data = await res.json();
                if (data.ok) {
                    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Sent';
                    btn.className = 'notify-btn sent';
                    showToast('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> ' + data.message);
                } else {
                    btn.textContent = ' No PSID';
                    btn.className = 'notify-btn failed';
                    showToast(' ' + data.message);
                    setTimeout(() => { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Notify'; btn.className = 'notify-btn'; }, 4000);
                }
            } catch (err) {
                btn.textContent = ' Offline';
                btn.className = 'notify-btn failed';
                showToast(' Server offline  run: npm start  in the messenger-mcp folder');
                setTimeout(() => { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Notify'; btn.className = 'notify-btn'; }, 4000);
            }
        }

        async function notifyAllAbsent() {
            const targets = currentSessionStudents.filter(s => s.status === 'absent' || s.status === 'late');
            if (!targets.length) { showToast('No absent or late students to notify.'); return; }
            showToast('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Sending ' + targets.length + ' notification(s)');
            for (const s of targets) {
                const idx = currentSessionStudents.indexOf(s);
                await notifyGuardian(idx);
            }
        }
        /* ----------------------------------------------------------------------------------------------------------------------------
           TOAST
        ---------------------------------------------------------------------------------------------------------------------------- */
        function showToast(msg) {
            const t = document.getElementById('toast');
            t.textContent = msg;
            t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), 3000);
        }

        function signOut() {
            DB.clearSession();
            window.location.href = 'index.html';
        }

        /* ----------------------------------------------------------------------------------------------------------------------------
           EXCUSE LETTERS PAGE
        ------------------------------------------------------------------------------------------------------------------------ */
        let excuseClassFilter = 'ALL';

        function renderExcuseLetters() {
            const td = DB.getTeacherData(session.id);
            const allStudents = DB.getAll().filter(u => u.role === 'student');

            // Collect all submitted excuse letters from all sessions
            const letters = [];
            Object.entries(td.sessions || {}).forEach(([key, records]) => {
                const parts = key.split('_');
                const classCode = parts[0];
                const date = parts.slice(1).join('_');
                const cls = (td.classes || []).find(c => c.code === classCode);
                records.forEach(r => {
                    if (r.excuse) {
                        letters.push({
                            classCode,
                            className: cls ? cls.name : classCode,
                            date,
                            studentId: r.studentId,
                            name: r.name || r.studentId,
                            excuse: r.excuse,
                            excuseFileName: r.excuseFileName || 'excuse_letter',
                            submittedAt: r.excuseSubmittedAt || null,
                            status: r.status,
                        });
                    }
                });
            });

            // Sort newest first
            letters.sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));

            // Update sidebar badge
            const badge = document.getElementById('excuseNavBadge');
            if (letters.length > 0) { badge.textContent = letters.length; badge.hidden = false; }
            else { badge.hidden = true; }

            // Build filter pills
            const classCodes = [...new Set(letters.map(l => l.classCode))];
            const filterBar = document.getElementById('excuseFilterBar');
            filterBar.innerHTML = [
                `<button class="excuse-filter-pill ${excuseClassFilter === 'ALL' ? 'active' : ''}" onclick="setExcuseFilter('ALL')">All Classes</button>`,
                ...classCodes.map(code => {
                    const cls = (td.classes || []).find(c => c.code === code);
                    return `<button class="excuse-filter-pill ${excuseClassFilter === code ? 'active' : ''}" onclick="setExcuseFilter('${code}')">${code} &mdash; ${cls ? cls.name : code}</button>`;
                })
            ].join('');

            // Filter by selected class
            const filtered = excuseClassFilter === 'ALL' ? letters : letters.filter(l => l.classCode === excuseClassFilter);

            const grid = document.getElementById('excuseCardsGrid');
            if (!filtered.length) {
                grid.innerHTML = `<div class="excuse-empty-state"><div style="font-size:42px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></div><p>No excuse letters ${excuseClassFilter !== 'ALL' ? 'for this class' : 'submitted yet'}</p><span>Letters will appear here once students upload them</span></div>`;
                return;
            }

            grid.innerHTML = filtered.map((l, i) => {
                const isImage = l.excuse.startsWith('data:image/');
                const dateFormatted = l.date ? new Date(l.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
                const submittedStr = l.submittedAt ? new Date(l.submittedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) :        /* ----------------------------------------------------------------------------------------------------------------------------
           REAL-TIME POLLING
        ---------------------------------------------------------------------------------------------------------------------------- */
                    // Cloud-sync.js handles the polling. We just need to react when
                    // it updates our local storage. renderDashboard is called by cloud-sync.
                    // We also have a local interval as a safety net.
                    setInterval(() => {
                        if (document.visibilityState === 'visible') {
                            loadAttendanceSession();
                        }
                    }, 3000);

                function syncExcusesFromDB() {
                    if (!currentClassCode || !currentDate) return;
                    const fresh = DB.getTeacherData(session.id);
                    const key = `${currentClassCode}_${currentDate}`;
                    const freshRecords = fresh.sessions[key] || [];
                    let changed = false;

                    // 1. Update excuse on any existing in-memory student record
                    currentSessionStudents.forEach(student => {
                        const fr = freshRecords.find(r => r.studentId === student.studentId);
                        if (fr && fr.excuse && fr.excuse !== student.excuse) {
                            student.excuse = fr.excuse;
                            student.excuseFileName = fr.excuseFileName || '';
                            student.excuseSubmittedAt = fr.excuseSubmittedAt || '';
                            if (student.status === 'absent') student.status = 'excused';
                            changed = true;
                        }
                    });

                    // 2. Add any DB records with excuses not yet in our in-memory list
                    freshRecords.forEach(fr => {
                        if (!fr.excuse) return;
                        const exists = currentSessionStudents.find(s => s.studentId === fr.studentId);
                        if (!exists) {
                            currentSessionStudents.push({
                                studentId: fr.studentId,
                                name: fr.name,
                                status: fr.status || 'excused',
                                timeIn: fr.timeIn || null,
                                timeOut: fr.timeOut || null,
                                remark: fr.remark || '',
                                excuse: fr.excuse,
                                excuseFileName: fr.excuseFileName || '',
                                excuseSubmittedAt: fr.excuseSubmittedAt || '',
                            });
                            changed = true;
                        }
                    });

                    if (changed) {
                        renderStudentTable(filterStudentsData());
                        showToast(' New excuse letter received from a student');

                        // Collect all newly-arrived excuse students so we can push per-student notifs
                        const newlyExcused = [];
                        freshRecords.forEach(fr => {
                            if (!fr.excuse) return;
                            // A record is "new" if it just appeared (was detected as changed above)
                            const student = currentSessionStudents.find(s => s.studentId === fr.studentId);
                            if (student && student.excuse === fr.excuse) {
                                // This record was the one that triggered the change
                                newlyExcused.push(student);
                            }
                        });
                        // Fallback: if we can't narrow it down, just push a generic notif
                        if (newlyExcused.length === 0) {
                            pushNotification({
                                icon: '',
                                title: 'New excuse letter',
                                body: 'A student submitted an excuse letter.',
                                time: new Date().toISOString(),
                            });
                        } else {
                            newlyExcused.forEach(s => {
                                pushNotification({
                                    icon: '',
                                    title: `Excuse letter from ${s.name}`,
                                    body: `Class ${currentClassCode}  ${currentDate}`,
                                    time: new Date().toISOString(),
                                });
                            });
                        }
                    }
                }

                //  Real-time: fires instantly when any other tab writes to localStorage 
                window.addEventListener('storage', function (e) {
                    // Only react to changes in this teacher's data key
                    if (e.key === 'attendease_teacher_' + session.id) {
                        syncExcusesFromDB();
                    }
                });

                //  Fallback poll every 1 s (handles same-tab and file:// edge cases) 
                setInterval(syncExcusesFromDB, 1000);

                /* ----------------------------------------------------------------------------------------------------------------------------
                   NOTIFICATIONS
                ---------------------------------------------------------------------------------------------------------------------------- */
                const NOTIF_KEY = () => `attendease_notifs_teacher_${session.id}`;

                // Load persisted notifications from localStorage
                function loadNotifications() {
                    try { return JSON.parse(localStorage.getItem(NOTIF_KEY()) || '[]'); }
                    catch { return []; }
                }

                function saveNotifications(list) {
                    try { localStorage.setItem(NOTIF_KEY(), JSON.stringify(list)); } catch { }
                }

                function pushNotification(notif) {
                    const list = loadNotifications();
                    list.unshift({ ...notif, id: Date.now() + Math.random(), read: false });
                    // Keep max 50 notifications
                    if (list.length > 50) list.splice(50);
                    saveNotifications(list);
                    renderNotifPanel();
                }

                /** Push a notification into a student's own notification store (cross-user, same origin) */
                function pushStudentNotification(studentId, notif) {
                    const key = `attendease_student_notifs_${studentId}`;
                    let list = [];
                    try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch { }
                    list.unshift({ ...notif, id: Date.now() + Math.random(), read: false, time: new Date().toISOString() });
                    if (list.length > 50) list.splice(50);
                    try { localStorage.setItem(key, JSON.stringify(list)); } catch { }
                }

                function renderNotifPanel() {
                    const list = loadNotifications();
                    const unread = list.filter(n => !n.read).length;
                    const badge = document.getElementById('notifBadge');
                    badge.textContent = unread > 99 ? '99+' : unread;
                    badge.hidden = unread === 0;

                    const listEl = document.getElementById('notifList');
                    if (!list.length) {
                        listEl.innerHTML = '<div class="notif-empty">No notifications yet</div>';
                        return;
                    }
                    listEl.innerHTML = list.map(n => `
                <div class="notif-item${n.read ? '' : ' notif-unread'}" data-id="${n.id}" onclick="markNotifRead(${n.id})">
                    <div class="notif-item-icon">${n.icon || ''}</div>
                    <div class="notif-item-body">
                        <div class="notif-item-title">${n.title}</div>
                        <div class="notif-item-sub">${n.body || ''}</div>
                        <div class="notif-item-time">${formatNotifTime(n.time)}</div>
                    </div>
                </div>
            `).join('');
                }

                function formatNotifTime(iso) {
                    if (!iso) return '';
                    const d = new Date(iso);
                    const now = new Date();
                    const diff = Math.floor((now - d) / 1000);
                    if (diff < 60) return 'Just now';
                    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
                    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
                    return d.toLocaleDateString();
                }

                function toggleNotifPanel() {
                    const panel = document.getElementById('notifPanel');
                    const btn = document.getElementById('notifBtn');
                    const isHidden = panel.hidden;

                    if (!isHidden) {
                        panel.hidden = true;
                        return;
                    }

                    // Position the panel below the bell button using its live bounding rect
                    const rect = btn.getBoundingClientRect();
                    panel.style.top = (rect.bottom + 8) + 'px';
                    panel.style.right = (window.innerWidth - rect.right) + 'px';
                    panel.style.left = 'auto';

                    panel.hidden = false;

                    // Mark all as read when opening
                    const list = loadNotifications().map(n => ({ ...n, read: true }));
                    saveNotifications(list);
                    renderNotifPanel();
                }

                function markNotifRead(id) {
                    const list = loadNotifications().map(n => n.id === id ? { ...n, read: true } : n);
                    saveNotifications(list);
                    renderNotifPanel();
                }

                function clearAllNotifs() {
                    saveNotifications([]);
                    renderNotifPanel();
                    document.getElementById('notifPanel').hidden = true;
                }

                // Close panel when clicking outside  must check BOTH wrapper and panel
                // since the panel is now a body-level element (not inside the wrapper)
                document.addEventListener('click', function (e) {
                    const wrapper = document.getElementById('notifWrapper');
                    const panel = document.getElementById('notifPanel');
                    if (!panel.hidden &&
                        wrapper && !wrapper.contains(e.target) &&
                        !panel.contains(e.target)) {
                        panel.hidden = true;
                    }
                });

                // Initial render on boot
                renderNotifPanel();

                /* ----------------------------------------------------------------------------------------------------------------------------
                   TEACHER PROFILE PICTURE
                ---------------------------------------------------------------------------------------------------------------------------- */
                function loadTeacherProfilePic() {
                    const td = DB.getTeacherData(session.id);
                    const avatarImg = document.getElementById('tAvatarImg');
                    const avatarInitials = document.getElementById('tAvatar');

                    if (td.profilePic) {
                        avatarImg.src = td.profilePic;
                        avatarImg.hidden = false;
                        avatarInitials.style.display = 'none';
                    } else {
                        avatarImg.hidden = true;
                        avatarImg.src = '';
                        avatarInitials.style.display = '';
                    }
                }

                function openTeacherProfileModal() {
                    const fullName = `${session.firstname} ${session.lastname}`.trim();
                    const initials = (session.firstname[0] + (session.lastname[0] || '')).toUpperCase();
                    const td = DB.getTeacherData(session.id);

                    document.getElementById('tProfileName').textContent = fullName || '';
                    document.getElementById('tProfileId').textContent = session.uid || '';
                    document.getElementById('tProfileEmail').textContent = session.email || '';

                    const profileAvatarInitials = document.getElementById('tProfileAvatarInitials');
                    const profileAvatarImg = document.getElementById('tProfileAvatarImg');
                    const removeBtn = document.getElementById('tRemovePhotoBtn');

                    profileAvatarInitials.textContent = initials;
                    if (td.profilePic) {
                        profileAvatarImg.src = td.profilePic;
                        profileAvatarImg.hidden = false;
                        profileAvatarInitials.style.display = 'none';
                        removeBtn.hidden = false;
                    } else {
                        profileAvatarImg.hidden = true;
                        profileAvatarImg.src = '';
                        profileAvatarInitials.style.display = '';
                        removeBtn.hidden = true;
                    }

                    document.getElementById('teacherProfileModal').hidden = false;
                }

                function closeTeacherProfileModal(e) {
                    if (!e || e.target === document.getElementById('teacherProfileModal')) {
                        document.getElementById('teacherProfileModal').hidden = true;
                    }
                }

                function handleTeacherProfilePicUpload(event) {
                    const file = event.target.files[0];
                    if (!file) return;
                    if (file.size > 2 * 1024 * 1024) {
                        showToast('Image too large  please use one under 2 MB.');
                        event.target.value = '';
                        return;
                    }
                    const reader = new FileReader();
                    reader.onload = ev => {
                        try {
                            const td = DB.getTeacherData(session.id);
                            td.profilePic = ev.target.result;
                            DB.saveTeacherData(session.id, td);

                            // Update sidebar avatar
                            const avatarImg = document.getElementById('tAvatarImg');
                            avatarImg.src = ev.target.result;
                            avatarImg.hidden = false;
                            document.getElementById('tAvatar').style.display = 'none';

                            // Update modal avatar
                            const profileAvatarImg = document.getElementById('tProfileAvatarImg');
                            profileAvatarImg.src = ev.target.result;
                            profileAvatarImg.hidden = false;
                            document.getElementById('tProfileAvatarInitials').style.display = 'none';
                            document.getElementById('tRemovePhotoBtn').hidden = false;

                            showToast('Profile picture saved ');
                        } catch (e) {
                            showToast('Could not save photo  storage may be full.');
                        }
                    };
                    reader.readAsDataURL(file);
                    event.target.value = '';
                }

                function removeTeacherProfilePic() {
                    const td = DB.getTeacherData(session.id);
                    delete td.profilePic;
                    DB.saveTeacherData(session.id, td);

                    const initials = (session.firstname[0] + (session.lastname[0] || '')).toUpperCase();

                    // Revert sidebar
                    const avatarImg = document.getElementById('tAvatarImg');
                    avatarImg.hidden = true;
                    avatarImg.src = '';
                    const avatarInitials = document.getElementById('tAvatar');
                    avatarInitials.textContent = initials;
                    avatarInitials.style.display = '';

                    // Revert modal
                    const profileAvatarImg = document.getElementById('tProfileAvatarImg');
                    profileAvatarImg.hidden = true;
                    profileAvatarImg.src = '';
                    document.getElementById('tProfileAvatarInitials').textContent = initials;
                    document.getElementById('tProfileAvatarInitials').style.display = '';
                    document.getElementById('tRemovePhotoBtn').hidden = true;

                    showToast('Profile picture removed');
                }

    