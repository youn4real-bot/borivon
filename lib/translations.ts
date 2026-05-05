export type Lang = "fr" | "en" | "de";

export interface Translation {
  dir: "ltr" | "rtl";
  pill: string;
  heroTitle: string;
  heroSub: string;
  backLabel: string;
  // step 0
  s0ey: string;
  s0ti: string;
  cInd: string;
  cOrg: string;
  arr: string;
  // step 1 person
  s1ey: string;
  s1ti: string;
  lA1: string; lA2: string; lB1: string; lB2: string; lNs: string;
  // step 1 org service
  s1oEy: string; s1oTi: string;
  coS1: string; coS2: string; coS3: string;
  // step 1 org format
  s1ofEy: string; s1ofTi: string;
  coF1: string; coF2: string;
  // step 2 person
  s2pEy: string; s2pTi: string;
  lblEmail: string; lblPhone: string; lblMsg: string; lblOpt: string;
  phEmail: string; phPhone: string; phMsg: string;
  // step 2 org
  s2oEy: string; s2oTi: string;
  lblWorkEmail: string; lblCompany: string;
  phWorkEmail: string; phCompany: string;
  // buttons
  sbtnP: string; sbtnO: string;
  pnote: string;
  // success
  okEy: string; okTi: string; okSub: string;
  // footer
  ftContact: string; ftPrivacy: string; ftTerms: string;
  footerCopy: string;
  // modal titles
  mContact: string; mPrivacy: string; mTerms: string;
  // summary helpers
  sumBase: string;
  sumSvcCourses: string; sumSvcTranslation: string; sumSvcOther: string;
  sumFmtOnline: string; sumFmtOnsite: string;
  // cookie
  ckAccept: string; ckDecline: string; ckText: string;
  ckBold: string; ckMid: string;
  // back arrow
  bArr: string;
  // short level label for person summary
  sumLevelLabel: string;
  // portal
  pTagline: string;
  pLogin: string; pSignup: string;
  pFirstName: string; pLastName: string; pPassword: string; pPasswordHint: string;
  pFirstNamePh: string; pLastNamePh: string;
  pErrFirstName: string; pErrLastName: string;
  pBtnLogin: string; pBtnSignup: string; pLoading: string;
  pCheckEmail: string; pCheckEmailDesc: string; pBackLogin: string;
  pDashWelcome: string; pDashSpace: string; pDashStatus: string; pDashDays: string;
  pUploadTitle: string; pUploadHint: string; pUploadDrag: string; pUploadConfirm: string;
  pDocsTitle: string; pNoDoc: string; pPending: string; pLogout: string; pContact: string;
  pTypeCV: string; pTypeDiploma: string; pTypeID: string; pTypeLetter: string; pTypeOther: string;
  pTypeLangCert: string; pTypeWorkCert: string;
  pTypeStudyProg: string; pTypeTranscript: string; pTypeAbitur: string; pTypeAbiturTranscript: string; pTypePraktikum: string;
  pTypeCVde: string; pTypeDiplomaDE: string; pTypeStudyProgDE: string; pTypeTranscriptDE: string;
  pTypeAbiturDE: string; pTypeAbiturTranscriptDE: string; pTypePraktikumDE: string; pTypeOtherTrans: string;
  pTypeWorkExp: string; pTypeWorkcertDE: string; pTypeWorkExpDE: string;
  pOriginalDocs: string; pTranslatedDocs: string;
  pHintCV: string; pHintDiploma: string; pHintID: string; pHintLetter: string;
  pHintLangCert: string; pHintWorkCert: string;
  pHintCVde: string; pHintDiplomaDE: string;
  pHintStudyProg: string; pHintTranscript: string; pHintAbitur: string; pHintAbiturTranscript: string; pHintPraktikum: string;
  pHintStudyProgDE: string; pHintTranscriptDE: string; pHintAbiturDE: string; pHintAbiturTranscriptDE: string; pHintPraktikumDE: string;
  pHintWorkExp: string; pHintWorkcertDE: string; pHintWorkExpDE: string;
  pOptional: string;
  pTransTooltipTitle: string; pTransTooltipMorocco: string; pTransTooltipMoroccoLink: string;
  pTransTooltipGermany: string; pTransTooltipGermanyLink: string;
  pStatusPending: string; pStatusApproved: string; pStatusRejected: string;
  pGroupIdentity: string; pGroupQualifications: string; pGroupExperience: string;
  pGroupLanguage: string; pGroupApplication: string; pGroupTranslations: string;
  pUploadBtn: string; pReplaceBtn: string; pExampleBtn: string; pExampleClose: string;
  pCVBuilderBtn: string;
  pProgress: string; pAllDone: string;
  pWizardIntroTitle: string; pWizardIntroSub: string; pWizardIntroCTA: string; pWizardIntroTime: string;
  pWizardOf: string;
  pWizardPhase1: string; pWizardPhase1Desc: string;
  pWizardPhase2: string; pWizardPhase2Desc: string;
  pWizardPhase3: string; pWizardPhase3Desc: string;
  pWizardPhase4: string; pWizardPhase4Desc: string;
  pWizardNext: string; pWizardSkip: string; pWizardDone: string; pWizardViewAll: string;
  pSideID: string; pSideNursing: string; pSideTrans: string; pSideOther: string;
  pWelcomeBack: string; pWelcomeBackSub: string;
  pUploadSuccess: string; pErrPdfOnly: string; pErrAllTypes: string; pErrSize: string; pErrImageOnly: string;
  pErrUpload: string; pErrNetwork: string; pSkipSaved: string; pDropHere: string;
  pTranslationsNote: string; pScanQualityNote: string; pOriginalsOnlyNote: string;
  pScanQualityShort: string; pOriginalsOnlyShort: string; pTranslationsShort: string;
  pWhatIsThis: string; pAddrHintBtn: string; pPostalHintBtn: string;
  pPassportTitle: string; pPassportSubtitle: string; pPassportNoData: string;
  pPassportConfirm: string; pPassportEdit: string; pPassportThanks: string; pPassportReviewNote: string; pPassportReviewNote2: string;
  pFieldFirstName: string; pFieldLastName: string; pFieldDob: string;
  pFieldSex: string; pFieldNationality: string; pFieldPassportNo: string; pFieldExpiry: string;
  pFieldCityOfBirth: string; pFieldCountryOfBirth: string; pFieldIssueDate: string;
  pFieldIssuingAuthority: string;
  pFieldAddressStreet: string; pFieldAddressNumber: string; pFieldAddressPostal: string;
  pFieldCityOfResidence: string; pFieldCountryOfResidence: string;
  pGuideBtn: string;
  pGuideWorkTitle: string; pGuideWorkIntro: string; pGuideWorkLegalNote: string;
  pGuideWorkDemandeNote: string; pGuideWorkMapsBtn: string; pGuideWorkDemandeBtn: string;
  pGuideWorkDoc1: string; pGuideWorkDoc2: string; pGuideWorkDoc3: string; pGuideWorkDoc4: string;
  pNamePh: string;
  pConfirmPassword: string; pErrPasswordMatch: string;
  pErrEmail: string; pErrPassword: string; pErrName: string; pErrExists: string; pErrWrong: string; pErrNotConfirmed: string;
  // ── CV Builder ─────────────────────────────────────────────────────────────
  cvb_title: string; cvb_subtitle: string;
  cvb_photoSection: string; cvb_photoInfo: string;
  cvb_choosePhoto: string; cvb_changePhoto: string; cvb_removePhoto: string;
  cvb_personalSection: string;
  cvb_firstName: string; cvb_lastName: string;
  cvb_birthDate: string; cvb_birthPlace: string;
  cvb_nationality: string; cvb_address: string;
  cvb_postalCode: string; cvb_city: string; cvb_phone: string;
  cvb_workSection: string; cvb_workWarning: string;
  cvb_gapPeriod: string; cvb_position: string;
  cvb_jobTitle: string; cvb_employer: string; cvb_location: string;
  cvb_deptLabel: string;
  cvb_startDate: string; cvb_endDate: string; cvb_inProgress: string;
  cvb_gapReasonLabel: string; cvb_gapReasonPh: string;
  cvb_addJob: string; cvb_addGap: string;
  cvb_eduSection: string;
  cvb_eduAbitur: string; cvb_eduNursing: string; cvb_eduOther: string;
  cvb_nursingStatusLabel: string;
  cvb_nursingComplete: string; cvb_nursingYear3: string; cvb_nursingYear2: string; cvb_nursingYear1: string;
  cvb_degreeLabel: string; cvb_institution: string;
  cvb_begin: string; cvb_end: string; cvb_addEdu: string;
  cvb_langSection: string; cvb_langLabel: string; cvb_levelLabel: string;
  cvb_notIncluded: string; cvb_addLang: string;
  cvb_edvSection: string; cvb_edvPh: string; cvb_edvAdd: string;
  cvb_otherSection: string;
  cvb_driverLicense: string; cvb_noLicense: string;
  cvb_hobbies: string; cvb_hobbiesPh: string;
  cvb_generateBtn: string; cvb_generating: string;
  cvb_successTitle: string; cvb_successSub: string;
  cvb_download: string; cvb_send: string; cvb_sending: string; cvb_sent: string;
  cvb_editCV: string;
  cvb_keepEditing: string; cvb_preview: string; cvb_submitCV: string;
  cvb_confirmTitle: string; cvb_confirmMsg: string;
  cvb_gapModalTitle: string; cvb_gapModalSub: string;
  cvb_gapAfter: string; cvb_gapAddBtn: string; cvb_gapIgnoreBtn: string;
  cvb_month: string; cvb_year: string; cvb_remove: string;
  cvb_photoErrType: string; cvb_photoErrSize: string;
  cvb_backToPortal: string;
  cvb_autoFill: string; cvb_autoFillDone: string;
  cvb_requiredFields: string;
  // ── Registration consent ─────────────────────────────────────────────────
  pConsentPre: string;
  pConsentLink: string;
  pConsentPost: string;
  pConsentRequired: string;
  // Box 2 — separate mandatory data-processing & third-party sharing consent
  pDataConsent: string;
  pDataConsentRequired: string;
  // ── Admin portal ────────────────────────────────────────────────────────────
  aTitle: string; aSubPending: string; aSubAllDone: string;
  aNothingTitle: string; aNothing: string;
  aPending: string; aDone: string;
  aAllReviewedTitle: string; aAllReviewed: string;
  aNoPendingSection: string; aGoPending: string;
  aApprove: string; aReject: string; aReset: string;
  aBack: string; aNext: string;
  aPreview: string; aDownload: string;
  aFeedbackPh: string;
  aShowReviewed: string; aHideReviewed: string;
  aShowArchive: string; aHideArchive: string;
  aNew: string;
  aWaiting: string; aCandidate: string; aCandidates: string; aDocument: string; aDocuments: string;
  aNoPreview: string;
  // ── Candidate journey stages ────────────────────────────────────────────────
  pJourneyDocs: string; pJourneyInterview: string; pJourneyRecognition: string;
  pJourneyEmbassy: string; pJourneyVisa: string; pJourneyFlight: string;
  pJourneyLocked: string;
  // Interview
  pInterviewPendingTitle: string; pInterviewPendingSub: string;
  pInterviewScheduledTitle: string; pInterviewJoinBtn: string;
  pInterviewPassedTitle: string; pInterviewPassedSub: string;
  pInterviewFailedTitle: string; pInterviewFailedSub: string;
  // Recognition
  pRecognitionTitle: string; pRecognitionSub: string; pRecognitionLockedMsg: string;
  // Embassy
  pEmbassyTitle: string; pEmbassySub: string; pEmbassyLockedMsg: string;
  // Visa
  pVisaLockedMsg: string; pVisaWaitingTitle: string; pVisaWaitingSub: string;
  pVisaGrantedTitle: string; pVisaGrantedSub: string; pVisaDateLabel: string;
  // Flight
  pFlightLockedMsg: string; pFlightTitle: string; pFlightDateLabel: string; pFlightInfoLabel: string;
  // Admin pipeline management
  aJourneySection: string;
  aInterviewLink: string; aInterviewDate: string; aInterviewStatus: string;
  aInterviewPassBtn: string; aInterviewFailBtn: string; aInterviewResetBtn: string;
  aUnlockRecognition: string; aLockRecognition: string;
  aUnlockEmbassy: string; aLockEmbassy: string;
  aVisaGrant: string; aVisaRevoke: string; aVisaDate: string;
  aFlightDate: string; aFlightInfo: string;
  aPipelineSave: string;
  aDocsApprove: string; aDocsRevoke: string;
  // ── Autosave indicator (cv-builder, dashboard passport form) ──────────────
  aSaving: string; aSaved: string; aSaveError: string;
  aJustNow: string; aSecAgo: string; aMinAgo: string; aHrAgo: string;
  aLoading: string;
  // ── Admin: error toasts (showError) ────────────────────────────────────────
  adErrVerify: string; adErrNetwork: string; adErrPassportSave: string; adErrDocStatus: string;
  adErrPipeline: string; adErrProfile: string; adErrPassportStatus: string; adErrDelete: string;
  // ── Admin: invite + agencies + filters + needs panel ───────────────────────
  adInviteLink: string; adCopy: string; adReset: string;
  adAgencies: string; adAgencyAdmin: string; adAgencyMember: string;
  adRemove: string; adAddToAgency: string; adNewAgencyPh: string;
  adCreating: string; adCreate: string;
  adOrgNeeds: string; adAnySpecialty: string; adSlot: string; adSlots: string;
  adMatched: string; adAssignCandidate: string; adLinked: string; adLink: string;
  adSuggestedMatches: string; adFromDate: string;
  adAcceptHint: string; adAccept: string; adSkipHint: string;
  adSelectOrg: string; adAdd: string; adNoActiveReqs: string;
  adNoLocDate: string; adCloseReq: string;
  adSpecialtyPh: string; adLocationPh: string; adSlotsPh: string;
  adSaveReq: string; adCancel: string;
  adSearchPh: string; adClearSearch: string;
  adFilterAll: string; adFilterPending: string; adFilterStuck: string; adFilterClear: string;
  adNoCandFound: string; adNoMatchFor: string;
  adNothingStuck: string; adNoStuckSub: string;
  adAllClearStatus: string; adPendingReviewLabel: string;
  adPeekDocs: string; adCollapse: string; adMoreOpen: string;
  adCandAbbr: string; adAdminAbbr: string;
  // ── Dashboard alerts + tooltips ────────────────────────────────────────────
  dErrPdfGen: string; dErrDownload: string; dErrPassportSave: string; dErrNetwork: string;
  dValMust5: string; dValLettersOnly: string;
  dTipFillFirst: string; dTipConfirmedUndo: string; dTipClickConfirm: string;
  // ── CV builder ─────────────────────────────────────────────────────────────
  cvbAdminEditing: string; cvbBackToAdmin: string; cvbUpgradeUnavail: string; cvbErrFallback: string;
  // ── Bug report ─────────────────────────────────────────────────────────────
  bugOnlyImg: string; bugDescribe: string; bugSendFail: string; bugRemoveScreenshot: string;
  // ── Sign request panel ─────────────────────────────────────────────────────
  srDocNameReq: string; srUploadPdf: string; srErr: string; srDragDrop: string;
  srSeen: string; srNotOpened: string;
  // ── Message icon (aria/alt + UI) ───────────────────────────────────────────
  miClose: string; miDownload: string; miAttachment: string; miPreview: string;
  miAttachImg: string; miSend: string; miRemoveAttach: string; miImage: string;
  // ── Profile icon (aria/title) ──────────────────────────────────────────────
  profProfileAria: string; profUpgradePlan: string;
  // ── Admin users panel ──────────────────────────────────────────────────────
  delUserAria: string;
  // ── Feed errors ────────────────────────────────────────────────────────────
  fdPostFail: string; fdNetErr: string;
  // ── Notification bell aria ─────────────────────────────────────────────────
  nbAria: string;
}

export const translations: Record<Lang, Translation> = {
  fr: {
    dir: "ltr",
    pill: "Inscriptions ouvertes",
    heroTitle: "<span style=\"color: var(--gold)\">Ambition</span> sans Limites.",
    heroSub: "Remplissez ce formulaire pour que nous puissions vous orienter au mieux.",
    backLabel: "Retour",
    s0ey: "Bienvenue", s0ti: "Qui décrit le mieux votre situation ?",
    cInd: "Particulier", cOrg: "Organisation", arr: "→",
    s1ey: "Niveau en allemand", s1ti: "Votre niveau actuel ?",
    lA1: "Débutant", lA2: "Élémentaire", lB1: "Intermédiaire", lB2: "Inter. supérieur", lNs: "Je ne sais pas",
    s1oEy: "Service souhaité", s1oTi: "De quoi avez-vous besoin ?",
    coS1: "Cours d'allemand", coS2: "Traduction & Interprétation", coS3: "Autre",
    s1ofEy: "Format", s1ofTi: "Quel format vous convient ?",
    coF1: "En ligne", coF2: "Dans vos locaux",
    s2pEy: "Presque fini", s2pTi: "Parlons-en.",
    lblEmail: "Email", lblPhone: "Téléphone", lblMsg: "Message", lblOpt: "(optionnel)",
    phEmail: "Adresse e-mail", phPhone: "Numéro de téléphone", phMsg: "Objectif, délai, disponibilités… (optionnel)",
    s2oEy: "Presque fini", s2oTi: "Parlons-en.",
    lblWorkEmail: "Email professionnel", lblCompany: "Nom de l'entreprise",
    phWorkEmail: "Email professionnel", phCompany: "Nom de l'entreprise (optionnel)",
    sbtnP: "Nous nous occuperons de vous →",
    sbtnO: "Nous vous recontacterons →",
    pnote: "Pas de spam. Aucun engagement.",
    okEy: "C'est fait !", okTi: "Nous vous recontacterons bientôt.",
    okSub: "Nous avons bien reçu votre demande et vous recontacterons dans les 24 heures.",
    ftContact: "Contact", ftPrivacy: "Politique de confidentialité", ftTerms: "Conditions générales",
    footerCopy: "© 2026 Borivon.com",
    mContact: "Contact", mPrivacy: "Politique de confidentialité", mTerms: "Conditions générales",
    sumBase: "Organisation",
    sumSvcCourses: "Cours d'allemand", sumSvcTranslation: "Trad. & Interp.", sumSvcOther: "Autre",
    sumFmtOnline: "En ligne", sumFmtOnsite: "Dans vos locaux",
    ckAccept: "Accepter", ckDecline: "Refuser",
    ckText: "Nous utilisons des cookies techniques essentiels uniquement — aucun cookie publicitaire.",
    ckBold: "Nous utilisons des cookies",
    ckMid: " \u2014 uniquement des cookies techniques essentiels. Aucun cookie publicitaire. En continuant, vous acceptez notre ",
    bArr: "\u2190",
    sumLevelLabel: "Niveau",
    pTagline: "Portail Candidat", pLogin: "Connexion", pSignup: "Créer un compte",
    pFirstName: "Prénom", pLastName: "Nom de famille",
    pFirstNamePh: "Prénom", pLastNamePh: "Nom",
    pErrFirstName: "Veuillez saisir votre prénom.", pErrLastName: "Veuillez saisir votre nom.",
    pPassword: "Mot de passe", pPasswordHint: "Minimum 6 caractères",
    pBtnLogin: "Se connecter", pBtnSignup: "Créer mon compte", pLoading: "Chargement…",
    pCheckEmail: "Vérifiez votre email",
    pCheckEmailDesc: "Un lien de confirmation a été envoyé à {email}. Cliquez dessus pour activer votre compte.",
    pBackLogin: "Retour à la connexion",
    pDashWelcome: "Bonjour", pDashSpace: "Votre espace personnel",
    pDashStatus: "Votre dossier est en cours d'examen. Nos experts vous répondront par email sous",
    pDashDays: "5 jours ouvrés",
    pUploadTitle: "Déposer un document", pUploadHint: "PDF, JPG, PNG ou DOCX — max 10 Mo",
    pUploadDrag: "Glissez votre fichier ici ou cliquez pour parcourir",
    pUploadConfirm: "Envoyer le document",
    pDocsTitle: "Documents déposés", pNoDoc: "Aucun document déposé pour le moment.",
    pPending: "En attente", pLogout: "Déconnexion", pContact: "Une question ?",
    pTypeCV: "CV", pTypeDiploma: "Diplôme Infirmier", pTypeID: "Passeport",
    pTypeLetter: "Lettre de motivation", pTypeOther: "Autre",
    pTypeLangCert: "Certificat de langue", pTypeWorkCert: "Certificat d'exercice de la profession infirmière",
    pTypeStudyProg: "Programme d'études Infirmier", pTypeTranscript: "Bulletin de notes Infirmier",
    pTypeAbitur: "Baccalauréat", pTypeAbiturTranscript: "Relevé de notes du Baccalauréat", pTypePraktikum: "Attestation de stage Infirmier",
    pTypeCVde: "CV (Allemand)", pTypeDiplomaDE: "Diplôme Infirmier (Allemand)",
    pTypeStudyProgDE: "Programme d'études Infirmier (Allemand)", pTypeTranscriptDE: "Bulletin de notes Infirmier (Allemand)",
    pTypeAbiturDE: "Baccalauréat (Allemand)", pTypeAbiturTranscriptDE: "Relevé de notes Baccalauréat (Allemand)", pTypePraktikumDE: "Attestation de stage Infirmier (Allemand)",
    pTypeOtherTrans: "Autre traduction",
    pOriginalDocs: "Documents originaux", pTranslatedDocs: "Traductions (Allemand)",
    pHintCV: "Votre historique professionnel et compétences",
    pHintDiploma: "Diplôme infirmier délivré par votre établissement. Deux types sont acceptés : 1. Diplôme ISPITS (Institut Staatlich de formation en soins infirmiers — niveau Licence/Bachelor) ; 2. Diplôme de formation délivré par un institut privé accrédité.",
    pHintID: "Passeport valide uniquement — la carte nationale d'identité n'est pas acceptée",
    pHintLetter: "Lettre expliquant votre motivation pour travailler en Allemagne",
    pHintLangCert: "Certificat B1 ou B2 — accepté uniquement : Goethe-Institut, ÖSD ou TELC",
    pHintWorkCert: "Autorisation officielle d'exercer la profession d'infirmier(e) — délivrée par le Ministère de la Santé au Maroc",
    pHintStudyProg: "Document officiel de votre école infirmière listant les modules, heures et matières de chaque année de formation",
    pHintTranscript: "Relevé de notes officiel de votre formation infirmière indiquant vos résultats par module et par année",
    pHintAbitur: "Diplôme du baccalauréat (Abitur) — document original",
    pHintAbiturTranscript: "Relevé de notes du baccalauréat avec résultats par matière",
    pHintPraktikum: "Attestation officielle de stage pratique délivrée par l'établissement",
    pHintCVde: "Votre CV rédigé ou traduit en allemand",
    pHintDiplomaDE: "Diplôme avec traduction certifiée en allemand (traducteur assermenté)",
    pHintStudyProgDE: "Programme d'études avec traduction certifiée en allemand",
    pHintTranscriptDE: "Bulletin de notes avec traduction certifiée en allemand",
    pHintAbiturDE: "Baccalauréat avec traduction certifiée en allemand",
    pHintAbiturTranscriptDE: "Relevé de notes du Baccalauréat avec traduction certifiée en allemand",
    pHintPraktikumDE: "Attestation de stage avec traduction certifiée en allemand",
    pTypeWorkExp: "Expérience professionnelle",
    pHintWorkExp: "(Optionnel) Attestation d'employeur ou certificat de travail issu d'un poste infirmier",
    pTypeWorkcertDE: "Certificat d'exercice (Allemand)",
    pHintWorkcertDE: "Certificat d'exercice de la profession infirmière avec traduction certifiée en allemand",
    pTypeWorkExpDE: "Expérience professionnelle (Allemand)",
    pHintWorkExpDE: "(Optionnel) Attestation d'employeur avec traduction certifiée en allemand",
    pOptional: "Optionnel",
    pTransTooltipTitle: "Traductions acceptées uniquement depuis :",
    pTransTooltipMorocco: "Traducteurs assermentés au Maroc :",
    pTransTooltipMoroccoLink: "Voir la liste des traducteurs au Maroc ↗",
    pTransTooltipGermany: "Traducteurs assermentés en Allemagne :",
    pTransTooltipGermanyLink: "Voir la liste des traducteurs en Allemagne ↗",
    pStatusPending: "En cours d'examen", pStatusApproved: "Approuvé", pStatusRejected: "Refusé",
    pGroupIdentity: "Identité", pGroupQualifications: "Qualifications", pGroupExperience: "Expérience",
    pGroupLanguage: "Langue", pGroupApplication: "Candidature", pGroupTranslations: "Traductions (Allemand)",
    pUploadBtn: "Déposer", pReplaceBtn: "Remplacer", pExampleBtn: "Voir un exemple", pExampleClose: "Fermer",
    pCVBuilderBtn: "Créer mon CV",
    pProgress: "{done} / {total} documents déposés", pAllDone: "Dossier complet !",
    pWizardIntroTitle: "Votre dossier de candidature", pWizardIntroSub: "Déposez vos documents en 4 étapes simples.", pWizardIntroCTA: "Commencer →", pWizardIntroTime: "~10 min pour démarrer",
    pWizardOf: "Étape {n} sur {total}",
    pWizardPhase1: "Essentiels", pWizardPhase1Desc: "Documents principaux pour démarrer votre dossier.",
    pWizardPhase2: "Qualifications", pWizardPhase2Desc: "Vos diplômes, attestations de formation et expérience professionnelle.",
    pWizardPhase3: "Traductions certifiées", pWizardPhase3Desc: "Déposez vos traductions certifiées si vous les avez — sinon revenez quand vous êtes prêt.",
    pWizardPhase4: "Documents complémentaires", pWizardPhase4Desc: "Votre lettre de motivation et certificat de langue.",
    pWizardNext: "Continuer →", pWizardSkip: "Je reviendrai plus tard", pWizardDone: "Voir mon dossier →", pWizardViewAll: "Voir tout le dossier",
    pSideID: "Essentiels", pSideNursing: "Diplômes", pSideTrans: "Traductions", pSideOther: "Autres",
    pWelcomeBack: "Bon retour,", pWelcomeBackSub: "Continuez là où vous en étiez.",
    pUploadSuccess: "✓ {label} déposé avec succès.", pErrPdfOnly: "PDF uniquement pour ce type de document.", pErrAllTypes: "PDF, JPG, PNG ou DOCX uniquement.", pErrSize: "Fichier trop volumineux. Max {size} Mo.", pErrImageOnly: "Image uniquement (JPG, PNG) — pas de PDF pour le passeport.",
    pErrUpload: "Erreur lors de l'envoi.", pErrNetwork: "Erreur réseau. Réessayez.", pSkipSaved: "Progression sauvegardée — revenez quand vous voulez !", pDropHere: "Déposez ici pour envoyer",
    pTranslationsNote: "Ces documents sont les traductions certifiées en allemand de vos originaux. Ne re-déposez pas les originaux ici.",
    pScanQualityNote: "📄 Seuls les documents scannés avec un scanner à plat sont acceptés. Les photos prises avec un téléphone ou via CamScanner seront automatiquement rejetées.",
    pOriginalsOnlyNote: "📎 Déposez uniquement les documents originaux ici. Les traductions certifiées en allemand seront demandées séparément à l'étape suivante.",
    pScanQualityShort: "Scanner machine uniquement — photos téléphone refusées.",
    pOriginalsOnlyShort: "Originaux uniquement — traductions assermentées à l'étape suivante.",
    pTranslationsShort: "Traducteurs assermentés uniquement :",
    pWhatIsThis: "C'est quoi ?", pAddrHintBtn: "Comment remplir ?", pPostalHintBtn: "Je ne sais pas",
    pPassportTitle: "Données extraites du passeport", pPassportSubtitle: "Vérifiez et corrigez si nécessaire, puis confirmez.", pPassportNoData: "Impossible d'extraire les données automatiquement. Saisissez-les manuellement.",
    pPassportConfirm: "Confirmer", pPassportEdit: "Modifier", pPassportThanks: "Tout coché, prêt à envoyer.", pPassportReviewNote: "Merci de vérifier et d'ajuster les informations si besoin.", pPassportReviewNote2: "Cochez les cases oranges pour confirmer chaque champ.",
    pFieldFirstName: "Prénom(s)", pFieldLastName: "Nom de famille", pFieldDob: "Date de naissance",
    pFieldSex: "Sexe", pFieldNationality: "Nationalité", pFieldPassportNo: "N° de passeport", pFieldExpiry: "Date d'expiration",
    pFieldCityOfBirth: "Ville de naissance", pFieldCountryOfBirth: "Pays de naissance", pFieldIssueDate: "Date de délivrance",
    pFieldIssuingAuthority: "Autorité de délivrance",
    pFieldAddressStreet: "Adresse (Quartier, Rue, Bâtiment, étage si applicable)", pFieldAddressNumber: "N° maison", pFieldAddressPostal: "Code postal",
    pFieldCityOfResidence: "Ville de résidence", pFieldCountryOfResidence: "Pays de résidence",
    pGuideBtn: "Comment l'obtenir ?",
    pGuideWorkTitle: "Comment obtenir le Certificat d'exercice de la profession infirmière",
    pGuideWorkIntro: "Rendez-vous au Ministère de la Santé à Rabat avec les documents suivants :",
    pGuideWorkLegalNote: "⚠️ Les documents 1 à 3 doivent être légalisés à votre **arrondissement** avant le dépôt.",
    pGuideWorkDemandeNote: "✓ La **Demande écrite** ne nécessite pas de légalisation.",
    pGuideWorkMapsBtn: "📍 Voir la localisation",
    pGuideWorkDemandeBtn: "Voir un exemple",
    pGuideWorkDoc1: "Copie du Baccalauréat — **légalisée à l'arrondissement**",
    pGuideWorkDoc2: "Copie du Diplôme Polyvalent — **légalisée à l'arrondissement**",
    pGuideWorkDoc3: "Copie de la Carte Nationale — **légalisée à l'arrondissement**",
    pGuideWorkDoc4: "**Demande écrite** adressée au Directeur de la Régulation",
    pNamePh: "Prénom Nom",
    pConfirmPassword: "Confirmer le mot de passe", pErrPasswordMatch: "Les mots de passe ne correspondent pas.",
    pErrEmail: "Adresse email invalide.", pErrPassword: "Le mot de passe doit contenir au moins 6 caractères.",
    pErrName: "Veuillez saisir votre nom.", pErrExists: "Un compte existe déjà avec cet email. Connectez-vous.",
    pErrWrong: "Email ou mot de passe incorrect.", pErrNotConfirmed: "Veuillez d'abord vérifier votre email (vérifiez vos spams).",
    cvb_title: "Créer mon Lebenslauf", cvb_subtitle: "Remplissez le formulaire — votre CV allemand est généré automatiquement en PDF.",
    cvb_photoSection: "Photo professionnelle", cvb_photoInfo: "Photo professionnelle obligatoire. Pas de selfie, pas de photo de vacances. Fond neutre (blanc/gris), tenue correcte, visage bien éclairé. Format JPG ou PNG, max 5 Mo.",
    cvb_choosePhoto: "Choisir une photo", cvb_changePhoto: "Changer", cvb_removePhoto: "Supprimer la photo",
    cvb_personalSection: "Données personnelles",
    cvb_firstName: "Prénom", cvb_lastName: "Nom de famille",
    cvb_birthDate: "Date de naissance", cvb_birthPlace: "Lieu de naissance",
    cvb_nationality: "Nationalité", cvb_address: "Adresse (rue, numéro)",
    cvb_postalCode: "Code postal", cvb_city: "Ville", cvb_phone: "Téléphone",
    cvb_workSection: "Expérience professionnelle", cvb_workWarning: "Les dates (mois/année) sont obligatoires. Tout écart entre deux postes doit être justifié par une entrée d'inactivité — le système le détecte automatiquement.",
    cvb_gapPeriod: "Période non travaillée", cvb_position: "Poste",
    cvb_jobTitle: "Titre du poste", cvb_employer: "Établissement (hôpital / clinique)", cvb_location: "Ville",
    cvb_deptLabel: "Service(s) — sélectionnez tout ce qui correspond",
    cvb_startDate: "Date de début", cvb_endDate: "Date de fin", cvb_inProgress: "En cours",
    cvb_gapReasonLabel: "Raison (ex : Apprentissage de l'allemand, Préparation des documents…)", cvb_gapReasonPh: "Apprentissage de la langue allemande",
    cvb_addJob: "Ajouter un poste", cvb_addGap: "Ajouter une période non travaillée",
    cvb_eduSection: "Formation",
    cvb_eduAbitur: "Baccalauréat", cvb_eduNursing: "Formation infirmière", cvb_eduOther: "Autre formation",
    cvb_nursingStatusLabel: "Statut de la formation",
    cvb_nursingComplete: "Diplôme obtenu ✓", cvb_nursingYear3: "3ème année (en cours)", cvb_nursingYear2: "2ème année (en cours)", cvb_nursingYear1: "1ère année (en cours)",
    cvb_degreeLabel: "Intitulé du diplôme", cvb_institution: "Établissement",
    cvb_begin: "Début", cvb_end: "Fin", cvb_addEdu: "Ajouter une autre formation",
    cvb_langSection: "Langues", cvb_langLabel: "Langue", cvb_levelLabel: "Niveau",
    cvb_notIncluded: "— (non inclus)", cvb_addLang: "Ajouter une langue",
    cvb_edvSection: "Informatique", cvb_edvPh: "Autre logiciel…", cvb_edvAdd: "Ajouter",
    cvb_otherSection: "Divers",
    cvb_driverLicense: "Permis de conduire", cvb_noLicense: "Aucun",
    cvb_hobbies: "Centres d'intérêt (optionnel)", cvb_hobbiesPh: "Lecture, Sport, Voyage…",
    cvb_generateBtn: "Générer mon Lebenslauf PDF", cvb_generating: "Génération en cours…",
    cvb_successTitle: "Lebenslauf généré avec succès\u00a0!", cvb_successSub: "Téléchargez votre CV ou envoyez-le directement dans votre dossier.",
    cvb_download: "Télécharger le PDF", cvb_send: "Envoyer dans mon dossier", cvb_sending: "Envoi…", cvb_sent: "Envoyé dans votre dossier",
    cvb_editCV: "Modifier le CV",
    cvb_keepEditing: "Continuer à modifier", cvb_preview: "Aperçu PDF", cvb_submitCV: "Soumettre mon CV",
    cvb_confirmTitle: "Tout est correct ?", cvb_confirmMsg: "Assurez-vous que toutes vos informations sont exactes. Une erreur peut entraîner le rejet de votre candidature et vous obliger à recommencer depuis le début.",
    cvb_gapModalTitle: "Interruptions détectées dans votre parcours", cvb_gapModalSub: "Le CV allemand doit couvrir toutes les périodes sans lacune. Les périodes suivantes ne sont pas couvertes :",
    cvb_gapAfter: "Après :", cvb_gapAddBtn: "Ajouter les périodes manquantes", cvb_gapIgnoreBtn: "Ignorer et générer",
    cvb_month: "Mois", cvb_year: "Année", cvb_remove: "Supprimer",
    cvb_photoErrType: "Veuillez sélectionner une image (JPG, PNG).", cvb_photoErrSize: "Photo trop grande (max 5 Mo).",
    cvb_backToPortal: "Retour au portail",
    cvb_autoFill: "Remplir depuis mon passeport", cvb_autoFillDone: "Données pré-remplies depuis votre passeport ✓",
    cvb_requiredFields: "Veuillez remplir les champs obligatoires (*) avant de générer.",
    pConsentPre: "En m'inscrivant, j'accepte les",
    pConsentLink: "Conditions Générales d'Utilisation",
    pConsentPost: "de Borivon.com.",
    pConsentRequired: "Veuillez accepter les conditions avant de créer un compte.",
    pDataConsent: "Je consens au traitement de mes données et à leur partage avec les tiers concernés afin de fournir les services demandés sur cette plateforme.",
    pDataConsentRequired: "Le consentement au traitement des données est obligatoire pour créer un compte.",
    aTitle: "Documents à examiner", aSubPending: "{n} document{s} en attente", aSubAllDone: "Tout est à jour — rien en attente.",
    aNothingTitle: "Rien à examiner", aNothing: "Tous les documents ont été traités.",
    aPending: "en attente", aDone: "Terminé",
    aAllReviewedTitle: "Tous les documents examinés", aAllReviewed: "Rien à traiter pour ce candidat.",
    aNoPendingSection: "Aucun document en attente dans cette section.", aGoPending: "Aller aux documents en attente →",
    aApprove: "✓ Approuver", aReject: "✕ Refuser", aReset: "↺",
    aBack: "← Retour", aNext: "Suivant →",
    aPreview: "👁 Aperçu", aDownload: "↓",
    aFeedbackPh: "Commentaire (optionnel — affiché au candidat si refusé)",
    aShowReviewed: "Afficher les documents examinés", aHideReviewed: "Masquer les documents examinés",
    aShowArchive: "Afficher l'archive", aHideArchive: "Masquer l'archive",
    aNew: "Nouveau",
    aWaiting: "en attente", aCandidate: "candidat", aCandidates: "candidats", aDocument: "document", aDocuments: "documents",
    aNoPreview: "Aucun aperçu disponible.",
    pJourneyDocs: "Documents", pJourneyInterview: "Entretien", pJourneyRecognition: "Reconnaissance",
    pJourneyEmbassy: "Ambassade", pJourneyVisa: "Visa", pJourneyFlight: "Vol",
    pJourneyLocked: "Finalisez les étapes précédentes pour débloquer",
    pInterviewPendingTitle: "Entretien à venir", pInterviewPendingSub: "Votre lien d'entretien apparaîtra ici dès qu'il sera programmé. Restez disponible.",
    pInterviewScheduledTitle: "Entretien programmé", pInterviewJoinBtn: "Rejoindre l'entretien",
    pInterviewPassedTitle: "Félicitations !", pInterviewPassedSub: "Vous avez réussi votre entretien. La prochaine étape est maintenant débloquée.",
    pInterviewFailedTitle: "Résultat communiqué", pInterviewFailedSub: "Nous vous contacterons très prochainement pour la suite.",
    pRecognitionTitle: "Documents de reconnaissance", pRecognitionSub: "Préparez les documents suivants pour votre dossier de reconnaissance professionnelle et votre visa de travail en Allemagne.", pRecognitionLockedMsg: "Cette étape se débloque après la réussite de votre entretien.",
    pEmbassyTitle: "Ambassade / TLS Contact", pEmbassySub: "Préparez ces documents pour votre rendez-vous de visa.", pEmbassyLockedMsg: "Cette étape se débloque une fois vos documents de reconnaissance validés.",
    pVisaLockedMsg: "Cette étape se débloque après votre rendez-vous à l'ambassade.", pVisaWaitingTitle: "Visa en cours de traitement", pVisaWaitingSub: "Votre demande de visa est en cours d'examen. Nous vous tiendrons informé.", pVisaGrantedTitle: "Visa accordé ! 🎉", pVisaGrantedSub: "Félicitations, votre visa de travail a été accordé. L'Allemagne vous attend !", pVisaDateLabel: "Date d'obtention",
    pFlightLockedMsg: "Votre date de départ sera communiquée ici dès qu'elle est confirmée.", pFlightTitle: "Votre vol vers l'Allemagne ✈️", pFlightDateLabel: "Date de départ", pFlightInfoLabel: "Informations de vol",
    aJourneySection: "Parcours candidat",
    aInterviewLink: "Lien d'entretien", aInterviewDate: "Date d'entretien", aInterviewStatus: "Statut",
    aInterviewPassBtn: "✓ Réussi", aInterviewFailBtn: "✕ Échoué", aInterviewResetBtn: "Réinitialiser",
    aUnlockRecognition: "Débloquer Reconnaissance", aLockRecognition: "Verrouiller Reconnaissance",
    aUnlockEmbassy: "Débloquer Ambassade", aLockEmbassy: "Verrouiller Ambassade",
    aVisaGrant: "Visa accordé ✓", aVisaRevoke: "Annuler visa", aVisaDate: "Date du visa",
    aFlightDate: "Date de vol", aFlightInfo: "Infos de vol",
    aPipelineSave: "Enregistrer",
    aDocsApprove: "🔓 Débloquer l'étape suivante", aDocsRevoke: "🔒 Verrouiller",
    // Autosave
    aSaving: "Enregistrement…", aSaved: "Enregistré", aSaveError: "Échec d'enregistrement",
    aJustNow: "à l'instant", aSecAgo: "il y a {n}s", aMinAgo: "il y a {n}min", aHrAgo: "il y a {n}h",
    aLoading: "Chargement",
    // Admin error toasts
    adErrVerify: "Impossible de mettre à jour la vérification — veuillez réessayer.",
    adErrNetwork: "Erreur réseau — veuillez réessayer.",
    adErrPassportSave: "Échec de l'enregistrement des données du passeport — veuillez réessayer.",
    adErrDocStatus: "Échec de la mise à jour du statut du document — veuillez réessayer.",
    adErrPipeline: "Échec de l'enregistrement du parcours — veuillez réessayer.",
    adErrProfile: "Échec de l'enregistrement du profil — veuillez réessayer.",
    adErrPassportStatus: "Échec de la mise à jour du statut du passeport — veuillez réessayer.",
    adErrDelete: "Échec de la suppression du candidat",
    // Admin: invite + agencies + filters + needs
    adInviteLink: "Lien d'invitation", adCopy: "Copier", adReset: "Réinitialiser",
    adAgencies: "Agences", adAgencyAdmin: "Admin agence", adAgencyMember: "Membre",
    adRemove: "Retirer", adAddToAgency: "Ajouter à cette agence :", adNewAgencyPh: "Nom de la nouvelle agence…",
    adCreating: "Création…", adCreate: "Créer",
    adOrgNeeds: "Besoins org", adAnySpecialty: "Toute spécialité", adSlot: "place", adSlots: "places",
    adMatched: "associé", adAssignCandidate: "Assigner un candidat…", adLinked: "lié", adLink: "Lier",
    adSuggestedMatches: "Suggestions", adFromDate: "à partir du",
    adAcceptHint: "Accepter — lie le candidat à l'organisation", adAccept: "Accepter",
    adSkipHint: "Ignorer — retire de la boîte de réception",
    adSelectOrg: "Sélectionner une organisation…", adAdd: "Ajouter", adNoActiveReqs: "Aucun besoin actif",
    adNoLocDate: "Aucun lieu/date défini", adCloseReq: "Clôturer le besoin",
    adSpecialtyPh: "Spécialité (ex. Pflege)", adLocationPh: "Lieu", adSlotsPh: "Places",
    adSaveReq: "Enregistrer le besoin", adCancel: "Annuler",
    adSearchPh: "Rechercher candidats par nom ou e-mail…", adClearSearch: "Effacer la recherche",
    adFilterAll: "Tous", adFilterPending: "En attente", adFilterStuck: "Bloqués > 7j", adFilterClear: "Tout réglé",
    adNoCandFound: "Aucun candidat trouvé", adNoMatchFor: "Aucun résultat pour « {q} ».",
    adNothingStuck: "Rien de bloqué", adNoStuckSub: "Aucun candidat n'attend depuis plus de 7 jours.",
    adAllClearStatus: "Tout réglé", adPendingReviewLabel: "À examiner",
    adPeekDocs: "Aperçu des docs en attente", adCollapse: "Réduire",
    adMoreOpen: "+ {n} de plus — ouvrir le panneau pour examiner",
    adCandAbbr: "cand.", adAdminAbbr: "admin",
    // Dashboard alerts
    dErrPdfGen: "Impossible de générer le PDF — veuillez réessayer.",
    dErrDownload: "Échec du téléchargement — veuillez réessayer.",
    dErrPassportSave: "Échec de l'enregistrement des données. Veuillez réessayer.",
    dErrNetwork: "Erreur réseau — vérifiez votre connexion et réessayez.",
    dValMust5: "Doit faire exactement 5 chiffres", dValLettersOnly: "Doit contenir uniquement des lettres",
    dTipFillFirst: "Remplissez ce champ d'abord", dTipConfirmedUndo: "Confirmé — cliquer pour annuler",
    dTipClickConfirm: "Cliquer pour confirmer",
    // CV builder
    cvbAdminEditing: "Mode admin — les modifications sont enregistrées dans le brouillon du candidat",
    cvbBackToAdmin: "Retour à l'admin",
    cvbUpgradeUnavail: "Mise à niveau indisponible pour le moment.",
    cvbErrFallback: "Erreur",
    // Bug report
    bugOnlyImg: "Images uniquement",
    bugDescribe: "Veuillez décrire le problème ou joindre une capture d'écran.",
    bugSendFail: "Échec de l'envoi", bugRemoveScreenshot: "Retirer la capture d'écran",
    // Sign request
    srDocNameReq: "Nom du document requis", srUploadPdf: "Veuillez téléverser un PDF",
    srErr: "Erreur", srDragDrop: "glisser-déposer ou cliquer",
    srSeen: "Vu", srNotOpened: "Pas encore ouvert",
    // Message icon
    miClose: "Fermer", miDownload: "Télécharger", miAttachment: "pièce jointe", miPreview: "aperçu",
    miAttachImg: "Joindre une image", miSend: "Envoyer", miRemoveAttach: "Retirer la pièce jointe",
    miImage: "image",
    // Profile icon
    profProfileAria: "Profil", profUpgradePlan: "Mettre à niveau",
    // Admin users panel
    delUserAria: "Supprimer {name}",
    // Feed errors
    fdPostFail: "Impossible de publier. Veuillez réessayer.",
    fdNetErr: "Erreur réseau — veuillez réessayer.",
    // Notification bell
    nbAria: "Notifications",
  },
  en: {
    dir: "ltr",
    pill: "Now enrolling",
    heroTitle: "<span style=\"color: var(--gold)\">Ambition</span> without Borders.",
    heroSub: "Fill in this form so we can serve you best.",
    backLabel: "Back",
    s0ey: "Welcome", s0ti: "What describes you best?",
    cInd: "Individual", cOrg: "Organization", arr: "→",
    s1ey: "German level", s1ti: "Your current level?",
    lA1: "Beginner", lA2: "Elementary", lB1: "Intermediate", lB2: "Upper-Int.", lNs: "Not sure",
    s1oEy: "Service needed", s1oTi: "What do you need?",
    coS1: "German courses", coS2: "Translation & Interpretation", coS3: "Other",
    s1ofEy: "Format", s1ofTi: "Which format suits you?",
    coF1: "Online", coF2: "At your premises",
    s2pEy: "Almost there", s2pTi: "Let's talk.",
    lblEmail: "Email", lblPhone: "Phone", lblMsg: "Message", lblOpt: "(optional)",
    phEmail: "Email address", phPhone: "Phone number", phMsg: "Goal, deadline, availability… (optional)",
    s2oEy: "Almost there", s2oTi: "Let's talk.",
    lblWorkEmail: "Work email", lblCompany: "Company name",
    phWorkEmail: "Work email", phCompany: "Company name (optional)",
    sbtnP: "We'll take care of you →",
    sbtnO: "We'll reach out →",
    pnote: "No spam. No commitment.",
    okEy: "Done!", okTi: "We'll be in touch soon.",
    okSub: "We received your request and will reach out within 24 hours.",
    ftContact: "Contact", ftPrivacy: "Privacy Policy", ftTerms: "Terms & Conditions",
    footerCopy: "© 2026 Borivon.com",
    mContact: "Contact", mPrivacy: "Privacy Policy", mTerms: "Terms & Conditions",
    sumBase: "Organization",
    sumSvcCourses: "German courses", sumSvcTranslation: "Transl. & Interp.", sumSvcOther: "Other",
    sumFmtOnline: "Online", sumFmtOnsite: "On-site",
    ckAccept: "Accept", ckDecline: "Decline",
    ckText: "We use strictly necessary technical cookies only — no advertising cookies.",
    ckBold: "We use cookies",
    ckMid: " \u2014 only strictly necessary technical cookies. No advertising cookies. By continuing you accept our ",
    bArr: "\u2190",
    sumLevelLabel: "Level",
    pTagline: "Candidate Portal", pLogin: "Sign in", pSignup: "Create account",
    pFirstName: "First name", pLastName: "Last name",
    pFirstNamePh: "First name", pLastNamePh: "Last name",
    pErrFirstName: "Please enter your first name.", pErrLastName: "Please enter your last name.",
    pPassword: "Password", pPasswordHint: "Minimum 6 characters",
    pBtnLogin: "Sign in", pBtnSignup: "Create my account", pLoading: "Loading…",
    pCheckEmail: "Check your email",
    pCheckEmailDesc: "A confirmation link was sent to {email}. Click it to activate your account.",
    pBackLogin: "Back to sign in",
    pDashWelcome: "Hello", pDashSpace: "Your personal space",
    pDashStatus: "Your application is under review. Our experts will reply by email within",
    pDashDays: "5 business days",
    pUploadTitle: "Upload a document", pUploadHint: "PDF, JPG, PNG or DOCX — max 10 MB",
    pUploadDrag: "Drag your file here or click to browse",
    pUploadConfirm: "Send document",
    pDocsTitle: "Uploaded documents", pNoDoc: "No documents uploaded yet.",
    pPending: "Pending", pLogout: "Sign out", pContact: "Any questions?",
    pTypeCV: "CV", pTypeDiploma: "Nursing Diploma", pTypeID: "Passport",
    pTypeLetter: "Cover letter", pTypeOther: "Other",
    pTypeLangCert: "Language Certificate", pTypeWorkCert: "Certificate of Nursing Practice",
    pTypeStudyProg: "Nursing Study Programme", pTypeTranscript: "Nursing Transcript",
    pTypeAbitur: "Baccalaureate", pTypeAbiturTranscript: "Baccalaureate Transcript", pTypePraktikum: "Nursing Internship Certificate",
    pTypeCVde: "CV (German)", pTypeDiplomaDE: "Nursing Diploma (German)",
    pTypeStudyProgDE: "Nursing Study Programme (German)", pTypeTranscriptDE: "Nursing Transcript (German)",
    pTypeAbiturDE: "Abitur (German)", pTypeAbiturTranscriptDE: "Abitur Transcript (German)", pTypePraktikumDE: "Nursing Internship Certificate (German)",
    pTypeOtherTrans: "Other translation",
    pOriginalDocs: "Original Documents", pTranslatedDocs: "Translations (German)",
    pHintCV: "Your work history and skills summary",
    pHintDiploma: "Nursing diploma issued by your institution. Two types are accepted: 1. ISPITS diploma (state nursing training institute — Bachelor level); 2. Training diploma from an accredited private institute.",
    pHintID: "Valid passport only — national ID card is not accepted",
    pHintLetter: "Letter explaining your motivation to work in Germany",
    pHintLangCert: "B1 or B2 German language certificate — accepted only: Goethe-Institut, ÖSD or TELC",
    pHintWorkCert: "Official license to practice nursing — issued by the Moroccan Ministry of Health in Rabat",
    pHintStudyProg: "Official document from your nursing school listing the modules, hours and subjects covered each year of training",
    pHintTranscript: "Official nursing grade sheet showing your results per module and per year of training",
    pHintAbitur: "Abitur diploma — original document",
    pHintAbiturTranscript: "Abitur grade sheet with results per subject",
    pHintPraktikum: "Official internship certificate issued by your training institution",
    pHintCVde: "Your CV written or translated in German",
    pHintDiplomaDE: "Diploma with certified German translation (sworn translator)",
    pHintStudyProgDE: "Study programme with certified German translation",
    pHintTranscriptDE: "Transcript with certified German translation",
    pHintAbiturDE: "Abitur with certified German translation",
    pHintAbiturTranscriptDE: "Abitur transcript with certified German translation",
    pHintPraktikumDE: "Internship certificate with certified German translation",
    pTypeWorkExp: "Work Experience",
    pHintWorkExp: "(Optional) Employment certificate or work attestation from a nursing position",
    pTypeWorkcertDE: "Certificate of Nursing Practice (German)",
    pHintWorkcertDE: "Certificate of Nursing Practice with certified German translation",
    pTypeWorkExpDE: "Work Experience (German)",
    pHintWorkExpDE: "(Optional) Employment certificate with certified German translation",
    pOptional: "Optional",
    pTransTooltipTitle: "Accepted translations only from:",
    pTransTooltipMorocco: "Sworn translators in Morocco:",
    pTransTooltipMoroccoLink: "View Morocco translator list ↗",
    pTransTooltipGermany: "Sworn translators in Germany:",
    pTransTooltipGermanyLink: "View Germany translator list ↗",
    pStatusPending: "Under review", pStatusApproved: "Approved", pStatusRejected: "Rejected",
    pGroupIdentity: "Identity", pGroupQualifications: "Qualifications", pGroupExperience: "Experience",
    pGroupLanguage: "Language", pGroupApplication: "Application", pGroupTranslations: "Translations (German)",
    pUploadBtn: "Upload", pReplaceBtn: "Replace", pExampleBtn: "See example", pExampleClose: "Close",
    pCVBuilderBtn: "Build my CV",
    pProgress: "{done} / {total} documents uploaded", pAllDone: "File complete!",
    pWizardIntroTitle: "Your application file", pWizardIntroSub: "Upload your documents in 4 simple steps.", pWizardIntroCTA: "Get started →", pWizardIntroTime: "~10 min to get started",
    pWizardOf: "Step {n} of {total}",
    pWizardPhase1: "Essentials", pWizardPhase1Desc: "Core documents to get your file started.",
    pWizardPhase2: "Qualifications", pWizardPhase2Desc: "Your diplomas, training documents and professional experience.",
    pWizardPhase3: "Certified translations", pWizardPhase3Desc: "Upload your certified German translations if you have them — otherwise come back when ready.",
    pWizardPhase4: "Other documents", pWizardPhase4Desc: "Your cover letter and language certificate.",
    pWizardNext: "Continue →", pWizardSkip: "I'll come back later", pWizardDone: "View my file →", pWizardViewAll: "View full file",
    pSideID: "Essentials", pSideNursing: "Qualif.", pSideTrans: "Translations", pSideOther: "Others",
    pWelcomeBack: "Welcome back,", pWelcomeBackSub: "Continue where you left off.",
    pUploadSuccess: "✓ {label} uploaded successfully.", pErrPdfOnly: "PDF only for this document type.", pErrAllTypes: "PDF, JPG, PNG or DOCX only.", pErrSize: "File too large. Max {size} MB.", pErrImageOnly: "Image only (JPG, PNG) — no PDF for passport.",
    pErrUpload: "Upload error. Please try again.", pErrNetwork: "Network error. Please try again.", pSkipSaved: "Progress saved — come back anytime!", pDropHere: "Drop here to upload",
    pTranslationsNote: "These are certified German translations of your original documents. Do not upload the originals again here.",
    pScanQualityNote: "📄 Only documents scanned with a flatbed scanner are accepted. Photos taken with a phone or via CamScanner apps will be automatically rejected.",
    pOriginalsOnlyNote: "📎 Upload original documents only here. Certified German translations will be requested separately in the next step.",
    pScanQualityShort: "Machine scanner only — phone photos rejected.",
    pOriginalsOnlyShort: "Originals only — sworn translations in the next step.",
    pTranslationsShort: "Sworn translators only:",
    pWhatIsThis: "What is this?", pAddrHintBtn: "How to fill this?", pPostalHintBtn: "I don't know it",
    pPassportTitle: "Passport data extracted", pPassportSubtitle: "Review and correct if needed, then confirm.", pPassportNoData: "Could not extract data automatically. Please fill in manually.",
    pPassportConfirm: "Confirm", pPassportEdit: "Edit", pPassportThanks: "All checked, ready to submit.", pPassportReviewNote: "Thank you for reviewing and adjusting the information.", pPassportReviewNote2: "Check the orange boxes to confirm each field.",
    pFieldFirstName: "First name(s)", pFieldLastName: "Last name", pFieldDob: "Date of birth",
    pFieldSex: "Sex", pFieldNationality: "Nationality", pFieldPassportNo: "Passport No.", pFieldExpiry: "Expiry date",
    pFieldCityOfBirth: "City of birth", pFieldCountryOfBirth: "Country of birth", pFieldIssueDate: "Issue date",
    pFieldIssuingAuthority: "Issuing authority",
    pFieldAddressStreet: "Address (District, Street, Building, Floor if any)", pFieldAddressNumber: "House No.", pFieldAddressPostal: "Postal code",
    pFieldCityOfResidence: "City of residence", pFieldCountryOfResidence: "Country of residence",
    pGuideBtn: "How to get it?",
    pGuideWorkTitle: "How to get your Certificate of Nursing Practice",
    pGuideWorkIntro: "Visit the Ministry of Health in Rabat with the following documents:",
    pGuideWorkLegalNote: "⚠️ Documents 1–3 must be **authenticated at the district office** before submitting.",
    pGuideWorkDemandeNote: "✓ The **Written request** does not need authentication.",
    pGuideWorkMapsBtn: "📍 Get location",
    pGuideWorkDemandeBtn: "Show example",
    pGuideWorkDoc1: "Baccalaureate certificate copy — **authenticated at the district office**",
    pGuideWorkDoc2: "Nursing Diploma copy — **authenticated at the district office**",
    pGuideWorkDoc3: "National ID copy — **authenticated at the district office**",
    pGuideWorkDoc4: "**Written request** addressed to the Director of Regulation",
    pNamePh: "First Last",
    pConfirmPassword: "Confirm password", pErrPasswordMatch: "Passwords do not match.",
    pErrEmail: "Invalid email address.", pErrPassword: "Password must be at least 6 characters.",
    pErrName: "Please enter your name.", pErrExists: "An account already exists for this email. Sign in.",
    pErrWrong: "Incorrect email or password.", pErrNotConfirmed: "Please verify your email first (check your spam folder).",
    cvb_title: "Build my Lebenslauf", cvb_subtitle: "Fill in the form — your German CV is automatically generated as a PDF.",
    cvb_photoSection: "Professional photo", cvb_photoInfo: "Professional photo required. No selfies, no vacation photos. Neutral background (white/grey), appropriate clothing, well-lit face. JPG or PNG, max 5 MB.",
    cvb_choosePhoto: "Choose a photo", cvb_changePhoto: "Change", cvb_removePhoto: "Remove photo",
    cvb_personalSection: "Personal data",
    cvb_firstName: "First name", cvb_lastName: "Last name",
    cvb_birthDate: "Date of birth", cvb_birthPlace: "Place of birth",
    cvb_nationality: "Nationality", cvb_address: "Address (street, number)",
    cvb_postalCode: "Postal code", cvb_city: "City", cvb_phone: "Phone",
    cvb_workSection: "Work Experience", cvb_workWarning: "Dates (month/year) are mandatory. Any gap between two positions must be explained by an inactivity entry — the system detects this automatically.",
    cvb_gapPeriod: "Gap period", cvb_position: "Position",
    cvb_jobTitle: "Job title", cvb_employer: "Establishment (hospital / clinic)", cvb_location: "City",
    cvb_deptLabel: "Department(s) — select all that apply",
    cvb_startDate: "Start date", cvb_endDate: "End date", cvb_inProgress: "Currently",
    cvb_gapReasonLabel: "Reason (e.g. Learning German, Preparing documents for Germany…)", cvb_gapReasonPh: "Learning the German language",
    cvb_addJob: "Add a position", cvb_addGap: "Add a gap period",
    cvb_eduSection: "Education",
    cvb_eduAbitur: "Baccalaureate", cvb_eduNursing: "Nursing Training", cvb_eduOther: "Other education",
    cvb_nursingStatusLabel: "Training status",
    cvb_nursingComplete: "Diploma obtained ✓", cvb_nursingYear3: "3rd year (in progress)", cvb_nursingYear2: "2nd year (in progress)", cvb_nursingYear1: "1st year (in progress)",
    cvb_degreeLabel: "Degree title", cvb_institution: "Institution",
    cvb_begin: "Start", cvb_end: "End", cvb_addEdu: "Add another education",
    cvb_langSection: "Languages", cvb_langLabel: "Language", cvb_levelLabel: "Level",
    cvb_notIncluded: "— (not included)", cvb_addLang: "Add a language",
    cvb_edvSection: "IT Skills", cvb_edvPh: "Other software…", cvb_edvAdd: "Add",
    cvb_otherSection: "Other",
    cvb_driverLicense: "Driver's license", cvb_noLicense: "None",
    cvb_hobbies: "Interests (optional)", cvb_hobbiesPh: "Reading, Sport, Travel…",
    cvb_generateBtn: "Generate my Lebenslauf PDF", cvb_generating: "Generating…",
    cvb_successTitle: "Lebenslauf generated successfully!", cvb_successSub: "Download your CV or send it directly to your file.",
    cvb_download: "Download PDF", cvb_send: "Send to my file", cvb_sending: "Sending…", cvb_sent: "Sent to your file",
    cvb_editCV: "Edit the CV",
    cvb_keepEditing: "Keep editing", cvb_preview: "Preview PDF", cvb_submitCV: "Submit my CV",
    cvb_confirmTitle: "Is everything correct?", cvb_confirmMsg: "Make sure all your information is accurate. Having something incorrect may get your application rejected and you would have to start all over again.",
    cvb_gapModalTitle: "Gaps detected in your career", cvb_gapModalSub: "The German CV must cover all periods without gaps. The following periods are not covered:",
    cvb_gapAfter: "After:", cvb_gapAddBtn: "Add the missing periods", cvb_gapIgnoreBtn: "Ignore and generate",
    cvb_month: "Month", cvb_year: "Year", cvb_remove: "Remove",
    cvb_photoErrType: "Please select an image (JPG, PNG).", cvb_photoErrSize: "Photo too large (max 5 MB).",
    cvb_backToPortal: "Back to portal",
    cvb_autoFill: "Fill from passport", cvb_autoFillDone: "Data pre-filled from your passport ✓",
    cvb_requiredFields: "Please fill in the required fields (*) before generating.",
    pConsentPre: "By registering, I agree to the",
    pConsentLink: "Terms & Conditions",
    pConsentPost: "of Borivon.com.",
    pConsentRequired: "Please accept the terms before creating an account.",
    pDataConsent: "I consent to my data being processed and shared with relevant third parties for the purpose of delivering the services I have requested on this platform.",
    pDataConsentRequired: "Data processing consent is required to create an account.",
    aTitle: "Documents to review", aSubPending: "{n} document{s} waiting", aSubAllDone: "All caught up — nothing pending.",
    aNothingTitle: "Nothing to review", aNothing: "All documents have been processed.",
    aPending: "pending", aDone: "Done",
    aAllReviewedTitle: "All documents reviewed", aAllReviewed: "Nothing left to action for this candidate.",
    aNoPendingSection: "No pending documents in this section.", aGoPending: "Go to pending →",
    aApprove: "✓ Approve", aReject: "✕ Reject", aReset: "↺",
    aBack: "← Back", aNext: "Next →",
    aPreview: "👁 Preview", aDownload: "↓",
    aFeedbackPh: "Feedback (optional — shown to candidate if rejected)",
    aShowReviewed: "Show reviewed documents", aHideReviewed: "Hide reviewed documents",
    aShowArchive: "Show archive", aHideArchive: "Hide archive",
    aNew: "New",
    aWaiting: "waiting", aCandidate: "candidate", aCandidates: "candidates", aDocument: "document", aDocuments: "documents",
    aNoPreview: "No preview available.",
    pJourneyDocs: "Documents", pJourneyInterview: "Interview", pJourneyRecognition: "Recognition",
    pJourneyEmbassy: "Embassy", pJourneyVisa: "Visa", pJourneyFlight: "Flight",
    pJourneyLocked: "Complete previous steps to unlock",
    pInterviewPendingTitle: "Interview Coming Up", pInterviewPendingSub: "Your interview link will appear here once scheduled. Stay available.",
    pInterviewScheduledTitle: "Interview Scheduled", pInterviewJoinBtn: "Join Interview",
    pInterviewPassedTitle: "Congratulations!", pInterviewPassedSub: "You passed your interview. The next step is now unlocked.",
    pInterviewFailedTitle: "Result Received", pInterviewFailedSub: "We will be in touch with you shortly about next steps.",
    pRecognitionTitle: "Recognition Documents", pRecognitionSub: "Prepare the following documents for your professional recognition and work visa application in Germany.", pRecognitionLockedMsg: "This step unlocks after passing your interview.",
    pEmbassyTitle: "Embassy / TLS Contact", pEmbassySub: "Prepare these documents for your visa appointment.", pEmbassyLockedMsg: "This step unlocks once your recognition documents are validated.",
    pVisaLockedMsg: "This step unlocks after your embassy appointment.", pVisaWaitingTitle: "Visa Being Processed", pVisaWaitingSub: "Your visa application is under review. We will keep you informed.", pVisaGrantedTitle: "Visa Granted! 🎉", pVisaGrantedSub: "Congratulations, your work visa has been granted. Germany awaits!", pVisaDateLabel: "Date granted",
    pFlightLockedMsg: "Your departure date will appear here once confirmed.", pFlightTitle: "Your Flight to Germany ✈️", pFlightDateLabel: "Departure date", pFlightInfoLabel: "Flight details",
    aJourneySection: "Candidate Journey",
    aInterviewLink: "Interview link", aInterviewDate: "Interview date", aInterviewStatus: "Status",
    aInterviewPassBtn: "✓ Passed", aInterviewFailBtn: "✕ Failed", aInterviewResetBtn: "Reset",
    aUnlockRecognition: "Unlock Recognition", aLockRecognition: "Lock Recognition",
    aUnlockEmbassy: "Unlock Embassy", aLockEmbassy: "Lock Embassy",
    aVisaGrant: "Visa granted ✓", aVisaRevoke: "Revoke visa", aVisaDate: "Visa date",
    aFlightDate: "Flight date", aFlightInfo: "Flight info",
    aPipelineSave: "Save",
    aDocsApprove: "🔓 Unlock Next Step", aDocsRevoke: "🔒 Lock",
    // Autosave
    aSaving: "Saving…", aSaved: "Saved", aSaveError: "Couldn't save",
    aJustNow: "just now", aSecAgo: "{n}s ago", aMinAgo: "{n}m ago", aHrAgo: "{n}h ago",
    aLoading: "Loading",
    // Admin error toasts
    adErrVerify: "Could not update verification — please try again.",
    adErrNetwork: "Network error — please try again.",
    adErrPassportSave: "Failed to save passport info — please try again.",
    adErrDocStatus: "Failed to update document status — please try again.",
    adErrPipeline: "Failed to save pipeline — please try again.",
    adErrProfile: "Failed to save profile — please try again.",
    adErrPassportStatus: "Failed to update passport status — please try again.",
    adErrDelete: "Failed to delete candidate",
    // Admin: invite + agencies + filters + needs
    adInviteLink: "Invite link", adCopy: "Copy", adReset: "Reset",
    adAgencies: "Agencies", adAgencyAdmin: "Agency Admin", adAgencyMember: "Member",
    adRemove: "Remove", adAddToAgency: "Add to this agency:", adNewAgencyPh: "New agency name…",
    adCreating: "Creating…", adCreate: "Create",
    adOrgNeeds: "Org needs", adAnySpecialty: "Any specialty", adSlot: "slot", adSlots: "slots",
    adMatched: "matched", adAssignCandidate: "Assign candidate…", adLinked: "linked", adLink: "Link",
    adSuggestedMatches: "Suggested matches", adFromDate: "from",
    adAcceptHint: "Accept — links candidate to org", adAccept: "Accept",
    adSkipHint: "Skip — removes from inbox",
    adSelectOrg: "Select organisation…", adAdd: "Add", adNoActiveReqs: "No active requirements yet",
    adNoLocDate: "No location/date set", adCloseReq: "Close requirement",
    adSpecialtyPh: "Specialty (e.g. Pflege)", adLocationPh: "Location", adSlotsPh: "Slots",
    adSaveReq: "Save requirement", adCancel: "Cancel",
    adSearchPh: "Search candidates by name or email…", adClearSearch: "Clear search",
    adFilterAll: "All", adFilterPending: "Pending review", adFilterStuck: "Stuck > 7d", adFilterClear: "All clear",
    adNoCandFound: "No candidates found", adNoMatchFor: "No matches for \"{q}\".",
    adNothingStuck: "Nothing stuck", adNoStuckSub: "No candidates have been waiting more than 7 days.",
    adAllClearStatus: "All clear", adPendingReviewLabel: "Pending review",
    adPeekDocs: "Peek pending docs", adCollapse: "Collapse",
    adMoreOpen: "+ {n} more — open full panel to review",
    adCandAbbr: "cand", adAdminAbbr: "admin",
    // Dashboard alerts
    dErrPdfGen: "Could not generate PDF — please try again.",
    dErrDownload: "Download failed — please try again.",
    dErrPassportSave: "Failed to save passport data. Please try again.",
    dErrNetwork: "Network error — please check your connection and try again.",
    dValMust5: "Must be exactly 5 digits", dValLettersOnly: "Should contain only letters",
    dTipFillFirst: "Fill in this field first", dTipConfirmedUndo: "Confirmed — click to undo",
    dTipClickConfirm: "Click to confirm",
    // CV builder
    cvbAdminEditing: "Admin editing — changes save to candidate's draft",
    cvbBackToAdmin: "Back to admin",
    cvbUpgradeUnavail: "Upgrade not available right now.",
    cvbErrFallback: "Error",
    // Bug report
    bugOnlyImg: "Only images allowed",
    bugDescribe: "Please describe the issue or attach a screenshot.",
    bugSendFail: "Failed to send", bugRemoveScreenshot: "Remove screenshot",
    // Sign request
    srDocNameReq: "Document name required", srUploadPdf: "Please upload a PDF",
    srErr: "Error", srDragDrop: "drag & drop or click",
    srSeen: "Seen", srNotOpened: "Not opened yet",
    // Message icon
    miClose: "Close", miDownload: "Download", miAttachment: "attachment", miPreview: "preview",
    miAttachImg: "Attach image", miSend: "Send", miRemoveAttach: "Remove attachment",
    miImage: "image",
    // Profile icon
    profProfileAria: "Profile", profUpgradePlan: "Upgrade plan",
    // Admin users panel
    delUserAria: "Delete {name}",
    // Feed errors
    fdPostFail: "Could not publish post. Please try again.",
    fdNetErr: "Network error — please try again.",
    // Notification bell
    nbAria: "Notifications",
  },
  de: {
    dir: "ltr",
    pill: "Jetzt einschreiben",
    heroTitle: "<span style=\"color: var(--gold)\">Ambitionen</span> ohne Grenzen.",
    heroSub: "Füllen Sie dieses Formular aus, damit wir Sie optimal betreuen können.",
    backLabel: "Zurück",
    s0ey: "Willkommen", s0ti: "Was beschreibt Sie am besten?",
    cInd: "Privatperson", cOrg: "Unternehmen", arr: "→",
    s1ey: "Deutschniveau", s1ti: "Ihr aktuelles Niveau?",
    lA1: "Anfänger", lA2: "Grundstufe", lB1: "Mittelstufe", lB2: "Obere Mittelst.", lNs: "Unsicher",
    s1oEy: "Gewünschte Leistung", s1oTi: "Was benötigen Sie?",
    coS1: "Deutschkurse", coS2: "Übersetzung & Dolmetschen", coS3: "Sonstiges",
    s1ofEy: "Format", s1ofTi: "Welches Format passt für Sie?",
    coF1: "Online", coF2: "In Ihrem Unternehmen",
    s2pEy: "Fast da", s2pTi: "Sprechen wir.",
    lblEmail: "E-Mail", lblPhone: "Telefon", lblMsg: "Nachricht", lblOpt: "(optional)",
    phEmail: "E-Mail-Adresse", phPhone: "Telefonnummer", phMsg: "Ziel, Zeitplan, Verfügbarkeit… (optional)",
    s2oEy: "Fast da", s2oTi: "Sprechen wir.",
    lblWorkEmail: "Geschäftliche E-Mail", lblCompany: "Unternehmensname",
    phWorkEmail: "Geschäftliche E-Mail", phCompany: "Unternehmensname (optional)",
    sbtnP: "Wir kümmern uns um Sie →",
    sbtnO: "Wir melden uns bei Ihnen →",
    pnote: "Kein Spam. Keine Verpflichtung.",
    okEy: "Geschafft!", okTi: "Wir melden uns bald.",
    okSub: "Anfrage erhalten. Wir melden uns innerhalb von 24 Stunden.",
    ftContact: "Kontakt", ftPrivacy: "Datenschutz", ftTerms: "AGB",
    footerCopy: "© 2026 Borivon.com",
    mContact: "Kontakt", mPrivacy: "Datenschutzerklärung", mTerms: "Allgemeine Geschäftsbedingungen",
    sumBase: "Unternehmen",
    sumSvcCourses: "Deutschkurse", sumSvcTranslation: "Übersetz. & Dolm.", sumSvcOther: "Sonstiges",
    sumFmtOnline: "Online", sumFmtOnsite: "Im Unternehmen",
    ckAccept: "Akzeptieren", ckDecline: "Ablehnen",
    ckText: "Wir verwenden ausschließlich technisch notwendige Cookies — keine Werbe-Cookies.",
    ckBold: "Wir verwenden Cookies",
    ckMid: " \u2014 ausschlie\u00dflich technisch notwendige. Keine Werbe-Cookies. Durch weitere Nutzung stimmen Sie unserer ",
    bArr: "\u2190",
    sumLevelLabel: "Niveau",
    pTagline: "Kandidaten-Portal", pLogin: "Anmelden", pSignup: "Konto erstellen",
    pFirstName: "Vorname", pLastName: "Nachname",
    pFirstNamePh: "Vorname", pLastNamePh: "Nachname",
    pErrFirstName: "Bitte geben Sie Ihren Vornamen ein.", pErrLastName: "Bitte geben Sie Ihren Nachnamen ein.",
    pPassword: "Passwort", pPasswordHint: "Mindestens 6 Zeichen",
    pBtnLogin: "Anmelden", pBtnSignup: "Konto erstellen", pLoading: "Laden…",
    pCheckEmail: "E-Mail prüfen",
    pCheckEmailDesc: "Ein Bestätigungslink wurde an {email} gesendet. Klicken Sie darauf, um Ihr Konto zu aktivieren.",
    pBackLogin: "Zurück zur Anmeldung",
    pDashWelcome: "Hallo", pDashSpace: "Ihr persönlicher Bereich",
    pDashStatus: "Ihre Bewerbung wird geprüft. Unsere Experten antworten Ihnen per E-Mail innerhalb von",
    pDashDays: "5 Werktagen",
    pUploadTitle: "Dokument hochladen", pUploadHint: "PDF, JPG, PNG oder DOCX — max. 10 MB",
    pUploadDrag: "Datei hierher ziehen oder klicken zum Durchsuchen",
    pUploadConfirm: "Dokument senden",
    pDocsTitle: "Hochgeladene Dokumente", pNoDoc: "Noch keine Dokumente hochgeladen.",
    pPending: "Ausstehend", pLogout: "Abmelden", pContact: "Fragen?",
    pTypeCV: "Lebenslauf", pTypeDiploma: "Pflegediplom", pTypeID: "Reisepass",
    pTypeLetter: "Anschreiben", pTypeOther: "Sonstiges",
    pTypeLangCert: "Sprachzertifikat", pTypeWorkCert: "Berufserlaubnis für Krankenpflege",
    pTypeStudyProg: "Pflegestudienprogramm", pTypeTranscript: "Pflegenotenblatt",
    pTypeAbitur: "Abitur", pTypeAbiturTranscript: "Abitur Notenblatt", pTypePraktikum: "Pflegepraktikumsnachweis",
    pTypeCVde: "Lebenslauf (DE)", pTypeDiplomaDE: "Pflegediplom (DE)",
    pTypeStudyProgDE: "Pflegestudienprogramm (DE)", pTypeTranscriptDE: "Pflegenotenblatt (DE)",
    pTypeAbiturDE: "Abitur (DE)", pTypeAbiturTranscriptDE: "Abitur Notenblatt (DE)", pTypePraktikumDE: "Pflegepraktikumsnachweis (DE)",
    pTypeOtherTrans: "Weitere Übersetzung",
    pOriginalDocs: "Originaldokumente", pTranslatedDocs: "Übersetzungen (Deutsch)",
    pHintCV: "Ihr beruflicher Werdegang und Ihre Fähigkeiten",
    pHintDiploma: "Pflegediplom Ihrer Einrichtung. Es werden zwei Typen anerkannt: 1. ISPITS-Abschluss (staatliches Pflegeinstitut — Bachelor-Niveau); 2. Ausbildungsdiplom einer akkreditierten privaten Einrichtung.",
    pHintID: "Nur gültiger Reisepass — nationaler Personalausweis wird nicht akzeptiert",
    pHintLetter: "Brief über Ihre Motivation, in Deutschland zu arbeiten",
    pHintLangCert: "Deutschzertifikat B1 oder B2 — nur akzeptiert: Goethe-Institut, ÖSD oder TELC",
    pHintWorkCert: "Offizielle Erlaubnis zur Ausübung des Pflegeberufs — ausgestellt vom marokkanischen Gesundheitsministerium in Rabat",
    pHintStudyProg: "Offizielles Dokument Ihrer Pflegeschule mit Modulen, Stunden und Fächern jedes Ausbildungsjahres",
    pHintTranscript: "Offizielles Pflegenotenblatt mit Ihren Ergebnissen pro Modul und Jahr",
    pHintAbitur: "Abitur-Zeugnis — Originaldokument",
    pHintAbiturTranscript: "Abitur-Notenblatt mit Ergebnissen pro Fach",
    pHintPraktikum: "Offizieller Praktikumsnachweis Ihrer Ausbildungseinrichtung",
    pHintCVde: "Ihr auf Deutsch verfasster oder übersetzter Lebenslauf",
    pHintDiplomaDE: "Diplom mit beglaubigter deutscher Übersetzung (vereidigter Übersetzer)",
    pHintStudyProgDE: "Studienprogramm mit beglaubigter deutscher Übersetzung",
    pHintTranscriptDE: "Notenblatt mit beglaubigter deutscher Übersetzung",
    pHintAbiturDE: "Abitur mit beglaubigter deutscher Übersetzung",
    pHintAbiturTranscriptDE: "Abitur-Notenblatt mit beglaubigter deutscher Übersetzung",
    pHintPraktikumDE: "Praktikumsnachweis mit beglaubigter deutscher Übersetzung",
    pTypeWorkExp: "Berufserfahrung",
    pHintWorkExp: "(Optional) Arbeitszeugnis oder Arbeitsbescheinigung aus einer Pflegestelle",
    pTypeWorkcertDE: "Berufserlaubnis für Krankenpflege (DE)",
    pHintWorkcertDE: "Berufserlaubnis für Krankenpflege mit beglaubigter deutscher Übersetzung",
    pTypeWorkExpDE: "Berufserfahrung (DE)",
    pHintWorkExpDE: "(Optional) Arbeitszeugnis mit beglaubigter deutscher Übersetzung",
    pOptional: "Optional",
    pTransTooltipTitle: "Übersetzungen nur akzeptiert von:",
    pTransTooltipMorocco: "Vereidigte Übersetzer in Marokko:",
    pTransTooltipMoroccoLink: "Übersetzerliste Marokko ansehen ↗",
    pTransTooltipGermany: "Vereidigte Übersetzer in Deutschland:",
    pTransTooltipGermanyLink: "Übersetzerliste Deutschland ansehen ↗",
    pStatusPending: "In Prüfung", pStatusApproved: "Genehmigt", pStatusRejected: "Abgelehnt",
    pGroupIdentity: "Identität", pGroupQualifications: "Qualifikationen", pGroupExperience: "Erfahrung",
    pGroupLanguage: "Sprache", pGroupApplication: "Bewerbung", pGroupTranslations: "Übersetzungen (Deutsch)",
    pUploadBtn: "Hochladen", pReplaceBtn: "Ersetzen", pExampleBtn: "Beispiel ansehen", pExampleClose: "Schließen",
    pCVBuilderBtn: "Lebenslauf erstellen",
    pProgress: "{done} / {total} Dokumente hochgeladen", pAllDone: "Akte vollständig!",
    pWizardIntroTitle: "Ihre Bewerbungsakte", pWizardIntroSub: "Laden Sie Ihre Dokumente in 4 einfachen Schritten hoch.", pWizardIntroCTA: "Loslegen →", pWizardIntroTime: "~10 Min. zum Starten",
    pWizardOf: "Schritt {n} von {total}",
    pWizardPhase1: "Essentielles", pWizardPhase1Desc: "Hauptdokumente zum Starten Ihrer Bewerbung.",
    pWizardPhase2: "Qualifikationen", pWizardPhase2Desc: "Ihre Diplome, Ausbildungsnachweise und Berufserfahrung.",
    pWizardPhase3: "Beglaubigte Übersetzungen", pWizardPhase3Desc: "Laden Sie Ihre Übersetzungen hoch, falls vorhanden — sonst kommen Sie einfach wieder.",
    pWizardPhase4: "Weitere Unterlagen", pWizardPhase4Desc: "Ihr Anschreiben und Ihr Sprachzertifikat.",
    pWizardNext: "Weiter →", pWizardSkip: "Ich komme später wieder", pWizardDone: "Meine Akte ansehen →", pWizardViewAll: "Gesamte Akte ansehen",
    pSideID: "Essentielles", pSideNursing: "Unterlagen", pSideTrans: "Übersetz.", pSideOther: "Sonstiges",
    pWelcomeBack: "Willkommen zurück,", pWelcomeBackSub: "Machen Sie weiter, wo Sie aufgehört haben.",
    pUploadSuccess: "✓ {label} erfolgreich hochgeladen.", pErrPdfOnly: "Nur PDF für diesen Dokumenttyp.", pErrAllTypes: "Nur PDF, JPG, PNG oder DOCX.", pErrSize: "Datei zu groß. Max {size} MB.", pErrImageOnly: "Nur Bild (JPG, PNG) — kein PDF für Reisepass.",
    pErrUpload: "Fehler beim Hochladen.", pErrNetwork: "Netzwerkfehler. Bitte erneut versuchen.", pSkipSaved: "Fortschritt gespeichert — kommen Sie jederzeit wieder!", pDropHere: "Hier ablegen zum Hochladen",
    pTranslationsNote: "Dies sind beglaubigte deutsche Übersetzungen Ihrer Originaldokumente. Laden Sie die Originale hier nicht erneut hoch.",
    pScanQualityNote: "📄 Nur mit einem Flachbettscanner gescannte Dokumente werden akzeptiert. Mit dem Handy oder CamScanner aufgenommene Fotos werden automatisch abgelehnt.",
    pOriginalsOnlyNote: "📎 Laden Sie hier nur Originaldokumente hoch. Beglaubigte deutsche Übersetzungen werden separat im nächsten Schritt angefordert.",
    pScanQualityShort: "Nur Maschinenscanner — Handyfotos abgelehnt.",
    pOriginalsOnlyShort: "Nur Originale — beglaubigte Übersetzungen (vereidigter Übersetzer) im nächsten Schritt.",
    pTranslationsShort: "Nur vereidigte Übersetzer:",
    pWhatIsThis: "Was ist das?", pAddrHintBtn: "Wie ausfüllen?", pPostalHintBtn: "Ich kenne sie nicht",
    pPassportTitle: "Passdaten extrahiert", pPassportSubtitle: "Prüfen und bei Bedarf korrigieren, dann bestätigen.", pPassportNoData: "Daten konnten nicht automatisch extrahiert werden. Bitte manuell eingeben.",
    pPassportConfirm: "Bestätigen", pPassportEdit: "Bearbeiten", pPassportThanks: "Alles abgehakt, bereit zum Absenden.", pPassportReviewNote: "Bitte Angaben prüfen und ggf. anpassen.", pPassportReviewNote2: "Haken Sie die orangefarbenen Kästchen ab, um jedes Feld zu bestätigen.",
    pFieldFirstName: "Vorname(n)", pFieldLastName: "Nachname", pFieldDob: "Geburtsdatum",
    pFieldSex: "Geschlecht", pFieldNationality: "Staatsangehörigkeit", pFieldPassportNo: "Reisepass-Nr.", pFieldExpiry: "Ablaufdatum",
    pFieldCityOfBirth: "Geburtsstadt", pFieldCountryOfBirth: "Geburtsland", pFieldIssueDate: "Ausstellungsdatum",
    pFieldIssuingAuthority: "Ausstellende Behörde",
    pFieldAddressStreet: "Adresse (Viertel, Straße, Gebäude, Etage falls vorhanden)", pFieldAddressNumber: "Hausnr.", pFieldAddressPostal: "PLZ",
    pFieldCityOfResidence: "Wohnort", pFieldCountryOfResidence: "Wohnland",
    pGuideBtn: "Wie bekomme ich sie?",
    pGuideWorkTitle: "So erhalten Sie die Berufsauserlaubnis für Krankenpflege",
    pGuideWorkIntro: "Gehen Sie zum Gesundheitsministerium in Rabat mit folgenden Dokumenten:",
    pGuideWorkLegalNote: "⚠️ Dokumente 1–3 müssen vor der Abgabe im **Rathaus beglaubigt** werden.",
    pGuideWorkDemandeNote: "✓ Der **Schriftliche Antrag** braucht keine Beglaubigung.",
    pGuideWorkMapsBtn: "📍 Standort anzeigen",
    pGuideWorkDemandeBtn: "Beispiel ansehen",
    pGuideWorkDoc1: "Kopie des **Abiturs** — **Beglaubigung im Rathaus**",
    pGuideWorkDoc2: "Kopie des **Pflegediploms** — **Beglaubigung im Rathaus**",
    pGuideWorkDoc3: "Kopie des **Ausweises** — **Beglaubigung im Rathaus**",
    pGuideWorkDoc4: "**Schriftlicher Antrag** an den Direktor der Regulierungsbehörde",
    pNamePh: "Vorname Nachname",
    pConfirmPassword: "Passwort bestätigen", pErrPasswordMatch: "Die Passwörter stimmen nicht überein.",
    pErrEmail: "Ungültige E-Mail-Adresse.", pErrPassword: "Das Passwort muss mindestens 6 Zeichen lang sein.",
    pErrName: "Bitte geben Sie Ihren Namen ein.", pErrExists: "Ein Konto mit dieser E-Mail existiert bereits. Bitte anmelden.",
    pErrWrong: "Falsche E-Mail oder falsches Passwort.", pErrNotConfirmed: "Bitte bestätigen Sie zuerst Ihre E-Mail (auch Spam prüfen).",
    cvb_title: "Meinen Lebenslauf erstellen", cvb_subtitle: "Füllen Sie das Formular aus — Ihr Lebenslauf wird automatisch als PDF generiert.",
    cvb_photoSection: "Berufliches Foto", cvb_photoInfo: "Berufliches Foto erforderlich. Keine Selfies, keine Urlaubsfotos. Neutraler Hintergrund (weiß/grau), angemessene Kleidung, gut beleuchtetes Gesicht. JPG oder PNG, max. 5 MB.",
    cvb_choosePhoto: "Foto auswählen", cvb_changePhoto: "Ändern", cvb_removePhoto: "Foto entfernen",
    cvb_personalSection: "Persönliche Daten",
    cvb_firstName: "Vorname", cvb_lastName: "Nachname",
    cvb_birthDate: "Geburtsdatum", cvb_birthPlace: "Geburtsort",
    cvb_nationality: "Staatsangehörigkeit", cvb_address: "Adresse (Straße, Hausnummer)",
    cvb_postalCode: "Postleitzahl", cvb_city: "Stadt", cvb_phone: "Telefon",
    cvb_workSection: "Berufserfahrung", cvb_workWarning: "Monats- und Jahresangaben sind Pflicht. Jede Lücke zwischen zwei Stellen muss durch einen Eintrag «\u00a0nicht tätig\u00a0» erklärt werden — das System erkennt dies automatisch.",
    cvb_gapPeriod: "Beschäftigungslücke", cvb_position: "Stelle",
    cvb_jobTitle: "Berufsbezeichnung", cvb_employer: "Einrichtung (Krankenhaus / Klinik)", cvb_location: "Stadt",
    cvb_deptLabel: "Abteilung(en) — alles Zutreffende auswählen",
    cvb_startDate: "Startdatum", cvb_endDate: "Enddatum", cvb_inProgress: "Aktuell / laufend",
    cvb_gapReasonLabel: "Grund (z.B. Deutschlernen, Vorbereitung der Dokumente für Deutschland…)", cvb_gapReasonPh: "Deutschlernen",
    cvb_addJob: "Stelle hinzufügen", cvb_addGap: "Beschäftigungslücke hinzufügen",
    cvb_eduSection: "Bildungsweg",
    cvb_eduAbitur: "Abitur", cvb_eduNursing: "Pflegeausbildung", cvb_eduOther: "Weitere Ausbildung",
    cvb_nursingStatusLabel: "Ausbildungsstatus",
    cvb_nursingComplete: "Diplom erhalten ✓", cvb_nursingYear3: "3. Jahr (in Ausbildung)", cvb_nursingYear2: "2. Jahr (in Ausbildung)", cvb_nursingYear1: "1. Jahr (in Ausbildung)",
    cvb_degreeLabel: "Studium / Abschluss", cvb_institution: "Einrichtung",
    cvb_begin: "Beginn", cvb_end: "Ende", cvb_addEdu: "Weitere Ausbildung hinzufügen",
    cvb_langSection: "Sprachkenntnisse", cvb_langLabel: "Sprache", cvb_levelLabel: "Niveau",
    cvb_notIncluded: "— (nicht einschließen)", cvb_addLang: "Sprache hinzufügen",
    cvb_edvSection: "EDV-Kenntnisse", cvb_edvPh: "Weitere Software…", cvb_edvAdd: "Hinzufügen",
    cvb_otherSection: "Sonstiges",
    cvb_driverLicense: "Führerschein", cvb_noLicense: "Nicht vorhanden",
    cvb_hobbies: "Hobbys (optional)", cvb_hobbiesPh: "Lesen, Sport, Reisen…",
    cvb_generateBtn: "Meinen Lebenslauf PDF generieren", cvb_generating: "Wird generiert…",
    cvb_successTitle: "Lebenslauf erfolgreich erstellt!", cvb_successSub: "Laden Sie Ihren Lebenslauf herunter oder senden Sie ihn direkt in Ihre Akte.",
    cvb_download: "PDF herunterladen", cvb_send: "In meine Akte senden", cvb_sending: "Wird gesendet…", cvb_sent: "In Ihre Akte gesendet",
    cvb_editCV: "Lebenslauf bearbeiten",
    cvb_keepEditing: "Weiter bearbeiten", cvb_preview: "PDF-Vorschau", cvb_submitCV: "Lebenslauf einreichen",
    cvb_confirmTitle: "Alles korrekt?", cvb_confirmMsg: "Stellen Sie sicher, dass alle Ihre Angaben korrekt sind. Fehlerhafte Informationen können zur Ablehnung Ihrer Bewerbung führen und Sie müssten von vorne beginnen.",
    cvb_gapModalTitle: "Lücken im Werdegang erkannt", cvb_gapModalSub: "Der Lebenslauf muss alle Zeiträume lückenlos abdecken. Folgende Zeiträume fehlen:",
    cvb_gapAfter: "Nach:", cvb_gapAddBtn: "Fehlende Zeiträume hinzufügen", cvb_gapIgnoreBtn: "Ignorieren und generieren",
    cvb_month: "Monat", cvb_year: "Jahr", cvb_remove: "Entfernen",
    cvb_photoErrType: "Bitte wählen Sie ein Bild aus (JPG, PNG).", cvb_photoErrSize: "Foto zu groß (max. 5 MB).",
    cvb_backToPortal: "Zurück zum Portal",
    cvb_autoFill: "Aus Reisepass ausfüllen", cvb_autoFillDone: "Daten aus Ihrem Reisepass vorausgefüllt ✓",
    cvb_requiredFields: "Bitte füllen Sie die Pflichtfelder (*) aus, bevor Sie generieren.",
    pConsentPre: "Mit der Registrierung stimme ich den",
    pConsentLink: "Allgemeinen Geschäftsbedingungen",
    pConsentPost: "von Borivon.com zu.",
    pConsentRequired: "Bitte akzeptieren Sie die Bedingungen, bevor Sie ein Konto erstellen.",
    pDataConsent: "Ich willige in die Verarbeitung meiner Daten und deren Weitergabe an relevante Dritte ein, um die auf dieser Plattform angeforderten Dienstleistungen zu erbringen.",
    pDataConsentRequired: "Die Einwilligung in die Datenverarbeitung ist für die Konto­erstellung erforderlich.",
    aTitle: "Dokumente zur Prüfung", aSubPending: "{n} Dokument{s} ausstehend", aSubAllDone: "Alles erledigt — nichts ausstehend.",
    aNothingTitle: "Nichts zu prüfen", aNothing: "Alle Dokumente wurden bearbeitet.",
    aPending: "ausstehend", aDone: "Erledigt",
    aAllReviewedTitle: "Alle Dokumente geprüft", aAllReviewed: "Nichts mehr zu tun für diesen Kandidaten.",
    aNoPendingSection: "Keine ausstehenden Dokumente in diesem Bereich.", aGoPending: "Zu ausstehenden Dokumenten →",
    aApprove: "✓ Genehmigen", aReject: "✕ Ablehnen", aReset: "↺",
    aBack: "← Zurück", aNext: "Weiter →",
    aPreview: "👁 Vorschau", aDownload: "↓",
    aFeedbackPh: "Feedback (optional — wird dem Kandidaten bei Ablehnung angezeigt)",
    aShowReviewed: "Geprüfte Dokumente anzeigen", aHideReviewed: "Geprüfte Dokumente ausblenden",
    aShowArchive: "Archiv anzeigen", aHideArchive: "Archiv ausblenden",
    aNew: "Neu",
    aWaiting: "ausstehend", aCandidate: "Kandidat", aCandidates: "Kandidaten", aDocument: "Dokument", aDocuments: "Dokumente",
    aNoPreview: "Keine Vorschau verfügbar.",
    pJourneyDocs: "Dokumente", pJourneyInterview: "Gespräch", pJourneyRecognition: "Anerkennung",
    pJourneyEmbassy: "Botschaft", pJourneyVisa: "Visum", pJourneyFlight: "Flug",
    pJourneyLocked: "Schließen Sie die vorherigen Schritte ab",
    pInterviewPendingTitle: "Gespräch steht bevor", pInterviewPendingSub: "Ihr Gesprächslink erscheint hier, sobald er geplant ist. Bleiben Sie verfügbar.",
    pInterviewScheduledTitle: "Gespräch geplant", pInterviewJoinBtn: "Gespräch beitreten",
    pInterviewPassedTitle: "Herzlichen Glückwunsch!", pInterviewPassedSub: "Sie haben Ihr Gespräch bestanden. Der nächste Schritt ist jetzt freigeschaltet.",
    pInterviewFailedTitle: "Ergebnis mitgeteilt", pInterviewFailedSub: "Wir werden uns in Kürze bezüglich der nächsten Schritte bei Ihnen melden.",
    pRecognitionTitle: "Anerkennungsdokumente", pRecognitionSub: "Bereiten Sie folgende Dokumente für Ihren Anerkennungsantrag und Ihr Arbeitsvisum in Deutschland vor.", pRecognitionLockedMsg: "Dieser Schritt wird nach Bestehen Ihres Gesprächs freigeschaltet.",
    pEmbassyTitle: "Botschaft / TLS Contact", pEmbassySub: "Bereiten Sie diese Dokumente für Ihren Visatermin vor.", pEmbassyLockedMsg: "Dieser Schritt wird freigeschaltet, sobald Ihre Anerkennungsdokumente validiert sind.",
    pVisaLockedMsg: "Dieser Schritt wird nach Ihrem Botschaftstermin freigeschaltet.", pVisaWaitingTitle: "Visum wird bearbeitet", pVisaWaitingSub: "Ihr Visumantrag wird geprüft. Wir halten Sie auf dem Laufenden.", pVisaGrantedTitle: "Visum erteilt! 🎉", pVisaGrantedSub: "Herzlichen Glückwunsch, Ihr Arbeitsvisum wurde erteilt. Deutschland wartet auf Sie!", pVisaDateLabel: "Erteilungsdatum",
    pFlightLockedMsg: "Ihr Abreisedatum erscheint hier, sobald es bestätigt ist.", pFlightTitle: "Ihr Flug nach Deutschland ✈️", pFlightDateLabel: "Abreisedatum", pFlightInfoLabel: "Flugdetails",
    aJourneySection: "Kandidatenreise",
    aInterviewLink: "Gesprächslink", aInterviewDate: "Gesprächsdatum", aInterviewStatus: "Status",
    aInterviewPassBtn: "✓ Bestanden", aInterviewFailBtn: "✕ Nicht bestanden", aInterviewResetBtn: "Zurücksetzen",
    aUnlockRecognition: "Anerkennung freischalten", aLockRecognition: "Anerkennung sperren",
    aUnlockEmbassy: "Botschaft freischalten", aLockEmbassy: "Botschaft sperren",
    aVisaGrant: "Visum erteilt ✓", aVisaRevoke: "Visum widerrufen", aVisaDate: "Visadatum",
    aFlightDate: "Flugdatum", aFlightInfo: "Fluginfos",
    aPipelineSave: "Speichern",
    aDocsApprove: "🔓 Nächsten Schritt freischalten", aDocsRevoke: "🔒 Sperren",
    // Autosave
    aSaving: "Wird gespeichert…", aSaved: "Gespeichert", aSaveError: "Speichern fehlgeschlagen",
    aJustNow: "gerade eben", aSecAgo: "vor {n}s", aMinAgo: "vor {n}min", aHrAgo: "vor {n}h",
    aLoading: "Lädt",
    // Admin error toasts
    adErrVerify: "Verifizierung konnte nicht aktualisiert werden — bitte erneut versuchen.",
    adErrNetwork: "Netzwerkfehler — bitte erneut versuchen.",
    adErrPassportSave: "Passdaten konnten nicht gespeichert werden — bitte erneut versuchen.",
    adErrDocStatus: "Dokumentstatus konnte nicht aktualisiert werden — bitte erneut versuchen.",
    adErrPipeline: "Pipeline konnte nicht gespeichert werden — bitte erneut versuchen.",
    adErrProfile: "Profil konnte nicht gespeichert werden — bitte erneut versuchen.",
    adErrPassportStatus: "Pass-Status konnte nicht aktualisiert werden — bitte erneut versuchen.",
    adErrDelete: "Kandidat konnte nicht gelöscht werden",
    // Admin: invite + agencies + filters + needs
    adInviteLink: "Einladungslink", adCopy: "Kopieren", adReset: "Zurücksetzen",
    adAgencies: "Agenturen", adAgencyAdmin: "Agentur-Admin", adAgencyMember: "Mitglied",
    adRemove: "Entfernen", adAddToAgency: "Zu dieser Agentur hinzufügen:", adNewAgencyPh: "Name der neuen Agentur…",
    adCreating: "Wird erstellt…", adCreate: "Erstellen",
    adOrgNeeds: "Org-Bedarf", adAnySpecialty: "Beliebige Fachrichtung", adSlot: "Platz", adSlots: "Plätze",
    adMatched: "zugeordnet", adAssignCandidate: "Kandidat zuweisen…", adLinked: "verknüpft", adLink: "Verknüpfen",
    adSuggestedMatches: "Vorschläge", adFromDate: "ab",
    adAcceptHint: "Annehmen — verknüpft Kandidat mit Org", adAccept: "Annehmen",
    adSkipHint: "Überspringen — entfernt aus dem Posteingang",
    adSelectOrg: "Organisation wählen…", adAdd: "Hinzufügen", adNoActiveReqs: "Noch keine aktiven Anforderungen",
    adNoLocDate: "Kein Ort/Datum festgelegt", adCloseReq: "Anforderung schließen",
    adSpecialtyPh: "Fachrichtung (z. B. Pflege)", adLocationPh: "Ort", adSlotsPh: "Plätze",
    adSaveReq: "Anforderung speichern", adCancel: "Abbrechen",
    adSearchPh: "Kandidaten nach Name oder E-Mail suchen…", adClearSearch: "Suche löschen",
    adFilterAll: "Alle", adFilterPending: "Zu prüfen", adFilterStuck: "Hängend > 7T", adFilterClear: "Alles erledigt",
    adNoCandFound: "Keine Kandidaten gefunden", adNoMatchFor: "Keine Treffer für „{q}\".",
    adNothingStuck: "Nichts hängt", adNoStuckSub: "Keine Kandidaten warten länger als 7 Tage.",
    adAllClearStatus: "Alles erledigt", adPendingReviewLabel: "Zu prüfen",
    adPeekDocs: "Ausstehende Docs anzeigen", adCollapse: "Einklappen",
    adMoreOpen: "+ {n} mehr — vollständiges Panel öffnen",
    adCandAbbr: "Kand.", adAdminAbbr: "Admin",
    // Dashboard alerts
    dErrPdfGen: "PDF konnte nicht erstellt werden — bitte erneut versuchen.",
    dErrDownload: "Download fehlgeschlagen — bitte erneut versuchen.",
    dErrPassportSave: "Passdaten konnten nicht gespeichert werden. Bitte erneut versuchen.",
    dErrNetwork: "Netzwerkfehler — bitte Verbindung prüfen und erneut versuchen.",
    dValMust5: "Muss genau 5 Ziffern lang sein", dValLettersOnly: "Darf nur Buchstaben enthalten",
    dTipFillFirst: "Bitte zuerst dieses Feld ausfüllen", dTipConfirmedUndo: "Bestätigt — zum Rückgängigmachen klicken",
    dTipClickConfirm: "Zum Bestätigen klicken",
    // CV builder
    cvbAdminEditing: "Admin bearbeitet — Änderungen werden im Entwurf des Kandidaten gespeichert",
    cvbBackToAdmin: "Zurück zum Admin",
    cvbUpgradeUnavail: "Upgrade momentan nicht verfügbar.",
    cvbErrFallback: "Fehler",
    // Bug report
    bugOnlyImg: "Nur Bilder erlaubt",
    bugDescribe: "Bitte das Problem beschreiben oder einen Screenshot anhängen.",
    bugSendFail: "Senden fehlgeschlagen", bugRemoveScreenshot: "Screenshot entfernen",
    // Sign request
    srDocNameReq: "Dokumentname erforderlich", srUploadPdf: "Bitte ein PDF hochladen",
    srErr: "Fehler", srDragDrop: "ziehen & ablegen oder klicken",
    srSeen: "Gesehen", srNotOpened: "Noch nicht geöffnet",
    // Message icon
    miClose: "Schließen", miDownload: "Herunterladen", miAttachment: "Anhang", miPreview: "Vorschau",
    miAttachImg: "Bild anhängen", miSend: "Senden", miRemoveAttach: "Anhang entfernen",
    miImage: "Bild",
    // Profile icon
    profProfileAria: "Profil", profUpgradePlan: "Plan upgraden",
    // Admin users panel
    delUserAria: "{name} löschen",
    // Feed errors
    fdPostFail: "Beitrag konnte nicht veröffentlicht werden. Bitte erneut versuchen.",
    fdNetErr: "Netzwerkfehler — bitte erneut versuchen.",
    // Notification bell
    nbAria: "Benachrichtigungen",
  },
};
