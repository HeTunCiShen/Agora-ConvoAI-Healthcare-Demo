// frontend/shared/profile-modal.js
class ProfileModal {
  constructor() {
    this.overlay = null;
  }

  open(profile) {
    this.close();
    const overlay = document.createElement('div');
    overlay.className = 'profile-modal-overlay';
    overlay.innerHTML = `
      <div class="profile-modal-panel">
        <div class="modal-header">
          <strong>${profile.name}</strong>
          <button class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-avatar">${profile.avatar}</div>
        ${profile.role === 'patient' ? this._patientBody(profile) : this._doctorBody(profile)}
      </div>
    `;
    overlay.querySelector('.modal-close').addEventListener('click', () => this.close());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); });
    document.body.appendChild(overlay);
    this.overlay = overlay;
  }

  close() {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  _patientBody(p) {
    const details = p.extra_details || {};
    const meds = Array.isArray(p.medications) ? p.medications : [];
    return `
      <div class="modal-section">
        <div class="modal-section-title">Personal</div>
        <div class="modal-row"><span class="key">Age</span><span class="val">${p.age}</span></div>
        <div class="modal-row"><span class="key">Blood Type</span><span class="val">${details.blood_type || '—'}</span></div>
        <div class="modal-row"><span class="key">Allergies</span><span class="val">${details.allergies || 'None'}</span></div>
        <div class="modal-row"><span class="key">Emergency Contact</span><span class="val">${details.emergency_contact || '—'}</span></div>
      </div>
      <div class="modal-section">
        <div class="modal-section-title">Condition</div>
        <div class="modal-row"><span class="key">Diagnosis</span><span class="val">${p.condition || '—'}</span></div>
        <div class="modal-row"><span class="key">Assigned Doctor</span><span class="val">${p.next_appointment || '—'}</span></div>
      </div>
      <div class="modal-section">
        <div class="modal-section-title">Medications</div>
        <div class="pill-list">${meds.map(m => `<span class="pill">${m}</span>`).join('')}</div>
      </div>
      <div class="modal-section">
        <div class="modal-section-title">Medical History</div>
        <p style="font-size:13px;color:#4b5563;line-height:1.6">${details.medical_history || '—'}</p>
      </div>
    `;
  }

  _doctorBody(d) {
    const details = d.extra_details || {};
    const langs = Array.isArray(details.languages) ? details.languages : [];
    const patients = Array.isArray(details.patients) ? details.patients : [];
    return `
      <div class="modal-section">
        <div class="modal-section-title">Professional</div>
        <div class="modal-row"><span class="key">Specialty</span><span class="val">${d.specialty || '—'}</span></div>
        <div class="modal-row"><span class="key">Hospital</span><span class="val">${d.hospital || '—'}</span></div>
        <div class="modal-row"><span class="key">Experience</span><span class="val">${details.experience || '—'}</span></div>
        <div class="modal-row"><span class="key">Qualifications</span><span class="val">${details.qualifications || '—'}</span></div>
      </div>
      <div class="modal-section">
        <div class="modal-section-title">Languages</div>
        <div class="pill-list">${langs.map(l => `<span class="pill">${l}</span>`).join('')}</div>
      </div>
      <div class="modal-section">
        <div class="modal-section-title">Bio</div>
        <p style="font-size:13px;color:#4b5563;line-height:1.6">${details.bio || '—'}</p>
      </div>
      <div class="modal-section">
        <div class="modal-section-title">Patients</div>
        <div class="pill-list">${patients.map(p => `<span class="pill">${p}</span>`).join('')}</div>
      </div>
    `;
  }
}
