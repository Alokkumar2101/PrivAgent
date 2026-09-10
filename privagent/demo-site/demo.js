/**
 * PrivAgent Demo Site :: login.html interactivity
 * Purely for the SIH demonstration — the PrivAgent extension observes and
 * protects this page; this script just prevents an actual navigation away
 * from the demo and gives immediate visual feedback for the risk-engine demo.
 */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      window.location.href = 'success.html';
    });
  }

  const deleteBtn = document.getElementById('deleteAccountBtn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      alert('This is a HIGH-RISK action.\n\nIf triggered via the PrivAgent voice/text command ("Delete my account"), the extension will require explicit user approval before proceeding. Try it via the extension popup!');
    });
  }

  const paymentBtn = document.getElementById('paymentBtn');
  if (paymentBtn) {
    paymentBtn.addEventListener('click', () => {
      alert('This is a HIGH-RISK action.\n\nIf triggered via the PrivAgent voice/text command ("Make a payment"), the extension will require explicit user approval before proceeding. Try it via the extension popup!');
    });
  }
});
