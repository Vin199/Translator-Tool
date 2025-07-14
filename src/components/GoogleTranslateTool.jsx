import React, { useState, useRef } from 'react';
import { Upload, Download, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

const GoogleTranslateAssessmentTool = () => {
  const [file, setFile] = useState(null);
  const [jsonData, setJsonData] = useState(null);
  const [translatedData, setTranslatedData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(1);
  const [selectedLanguages, setSelectedLanguages] = useState([]);
  const [apiConfig] = useState({
    apiKey: import.meta.env.VITE_GOOGLE_TRANSLATE_API_KEY || '',
    baseUrl: 'https://translation.googleapis.com/language/translate/v2'
  });
  const fileInputRef = useRef(null);

  // Google Translate supported Indian languages
  const supportedLanguages = [
    { code: 'hi', name: 'Hindi', native: 'हिंदी' },
    { code: 'bn', name: 'Bengali', native: 'বাংলা' },
    { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
    { code: 'te', name: 'Telugu', native: 'తెలుగు' },
    { code: 'mr', name: 'Marathi', native: 'मराठी' },
    { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
    { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
    { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
    { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
    { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ' },
    { code: 'as', name: 'Assamese', native: 'অসমীয়া' },
    { code: 'ur', name: 'Urdu', native: 'اردو' },
    { code: 'ne', name: 'Nepali', native: 'नेपाली' },
    { code: 'sa', name: 'Sanskrit', native: 'संस्कृत' }
  ];

  const handleFileUpload = (event) => {
    const uploadedFile = event.target.files[0];
    if (uploadedFile) {
      if (
        uploadedFile.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        uploadedFile.type === 'application/vnd.ms-excel'
      ) {
        setFile(uploadedFile);
        setError('');
        convertToJSON(uploadedFile);
      } else {
        setError('Please upload a valid Excel file (.xlsx or .xls)');
      }
    }
  };

  const convertToJSON = async (file) => {
    try {
      setLoading(true);
      setError('');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      // Convert to structured format
      const headers = jsonData[0];
      const rows = jsonData.slice(1).map((row) => {
        const obj = {};
        headers.forEach((header, index) => {
          obj[header] = row[index] || '';
        });
        return obj;
      });

      setJsonData({ headers, rows });
      setStep(2);
    } catch (err) {
      setError('Error converting Excel to JSON: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLanguageSelection = (langCode) => {
    setSelectedLanguages((prev) => 
      prev.includes(langCode) 
        ? prev.filter((code) => code !== langCode) 
        : [...prev, langCode]
    );
  };

  // Google Translate batch function
  const translateTextBatch = async (texts, targetLang) => {
    if (!apiConfig.apiKey) {
      return texts.map((text) => `[${targetLang.toUpperCase()}] ${text}`);
    }

    try {
      // Filter out empty texts
      const nonEmptyTexts = texts.filter(text => text && text.trim());
      if (nonEmptyTexts.length === 0) {
        return texts;
      }

      const response = await fetch(`${apiConfig.baseUrl}?key=${apiConfig.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: nonEmptyTexts,
          target: targetLang,
          source: 'en',
          format: 'text'
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Translation failed: ${errorData.error?.message || response.statusText}`);
      }

      const result = await response.json();
      const translations = result.data.translations;

      // Map back to original array with empty texts preserved
      let translationIndex = 0;
      return texts.map(text => {
        if (!text || !text.trim()) {
          return text;
        }
        return translations[translationIndex++]?.translatedText || text;
      });

    } catch (error) {
      console.warn(`Batch translation failed for ${texts.length} texts to ${targetLang}:`, error);
      return texts.map((text) => `[Translation Error: ${text}]`);
    }
  };

  // Optimized translation function with parallel processing
  const translateAssessment = async () => {
    if (!jsonData || selectedLanguages.length === 0) {
      setError('Please upload a file and select languages');
      return;
    }

    setLoading(true);
    setStep(3);
    const translated = {};

    try {
      // Process all languages in parallel
      const languagePromises = selectedLanguages.map(async (langCode) => {
        // Collect all unique texts that need translation
        const textsToTranslate = [];
        const textIndexMap = new Map();

        jsonData.rows.forEach((row) => {
          Object.entries(row).forEach(([, value]) => {
            if (typeof value === 'string' && value.trim()) {
              if (!textIndexMap.has(value)) {
                textIndexMap.set(value, textsToTranslate.length);
                textsToTranslate.push(value);
              }
            }
          });
        });

        // Batch translate all unique texts - Google Translate can handle larger batches
        const BATCH_SIZE = 50; // Google Translate can handle more texts per request
        const translatedTexts = [];

        for (let i = 0; i < textsToTranslate.length; i += BATCH_SIZE) {
          const batch = textsToTranslate.slice(i, i + BATCH_SIZE);
          const batchResults = await translateTextBatch(batch, langCode);
          translatedTexts.push(...batchResults);
          
          // Small delay to respect rate limits
          if (i + BATCH_SIZE < textsToTranslate.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        // Create translation lookup map
        const translationMap = new Map();
        textsToTranslate.forEach((originalText, index) => {
          translationMap.set(originalText, translatedTexts[index]);
        });

        // Build translated rows using the lookup map
        const translatedRows = jsonData.rows.map((row) => {
          const translatedRow = {};
          Object.entries(row).forEach(([key, value]) => {
            if (typeof value === 'string' && value.trim()) {
              translatedRow[key] = translationMap.get(value) || value;
            } else {
              translatedRow[key] = value;
            }
          });
          return translatedRow;
        });

        return {
          langCode,
          data: {
            headers: [...jsonData.headers],
            rows: translatedRows,
          },
        };
      });

      // Wait for all languages to complete
      const results = await Promise.all(languagePromises);

      // Organize results by language
      results.forEach(({ langCode, data }) => {
        translated[langCode] = data;
      });

      setTranslatedData(translated);
      setStep(4);
    } catch (err) {
      setError('Translation failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const downloadCSV = (langCode) => {
    const data = translatedData[langCode];
    if (!data) return;

    const csv = Papa.unparse({
      fields: data.headers,
      data: data.rows.map((row) => data.headers.map((header) => row[header] || '')),
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `assessment_${langCode}_translated.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const downloadAllExcel = () => {
    if (Object.keys(translatedData).length === 0) return;

    const workbook = XLSX.utils.book_new();

    // Add a sheet for each translated language
    selectedLanguages.forEach((langCode) => {
      const data = translatedData[langCode];
      if (!data) return;

      const lang = supportedLanguages.find((l) => l.code === langCode);
      const sheetName = lang ? `${lang.name} (${lang.code})` : langCode;

      // Convert data to worksheet format
      const worksheetData = [
        data.headers,
        ...data.rows.map((row) => data.headers.map((header) => row[header] || ''))
      ];

      const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
      
      // Add some basic formatting
      const range = XLSX.utils.decode_range(worksheet['!ref']);
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
        if (worksheet[cellAddress]) {
          worksheet[cellAddress].s = {
            font: { bold: true },
            fill: { fgColor: { rgb: "E2E8F0" } }
          };
        }
      }

      // Set column widths
      const columnWidths = data.headers.map(() => ({ width: 20 }));
      worksheet['!cols'] = columnWidths;

      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    });

    // Generate and download the Excel file
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `assessment_all_languages_translated.xlsx`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = (langCode) => {
    const data = translatedData[langCode];
    if (!data) return;

    const csv = Papa.unparse({
      fields: data.headers,
      data: data.rows.map((row) => data.headers.map((header) => row[header] || '')),
    });

    navigator.clipboard.writeText(csv).then(() => {
      alert(`${supportedLanguages.find((l) => l.code === langCode)?.name} data copied to clipboard!`);
    });
  };

  const resetTool = () => {
    setFile(null);
    setJsonData(null);
    setTranslatedData({});
    setSelectedLanguages([]);
    setStep(1);
    setError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className={`mx-auto transition-all duration-300 ${
        step === 4 && Object.keys(translatedData).length > 0 
          ? 'max-w-none w-full' 
          : 'max-w-6xl'
      }`}>
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Assessment Translation Tool</h1>
            <p className="text-gray-600">Upload Excel assessments and translate them into multiple Indian languages using Google Translate</p>
          </div>

          {/* Progress Steps */}
          <div className="flex justify-center mb-8">
            <div className="flex items-center space-x-4">
              {[1, 2, 3, 4].map((num) => (
                <div key={num} className="flex items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                    ${step >= num ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>
                    {num}
                  </div>
                  {num < 4 && <div className="w-8 h-0.5 bg-gray-200 mx-2"></div>}
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center">
              <AlertCircle className="h-5 w-5 text-red-500 mr-2" />
              <span className="text-red-700">{error}</span>
            </div>
          )}

          {/* Step 1: File Upload */}
          {step === 1 && (
            <div className="space-y-6">
              {!apiConfig.apiKey && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <h3 className="font-semibold text-orange-800 mb-2">Demo Mode</h3>
                  <p className="text-orange-700 text-sm">
                    No Google Translate API key found in environment variables. Running in demo mode with mock translations.
                    <br />
                    Add VITE_GOOGLE_TRANSLATE_API_KEY to your .env file for real translations.
                  </p>
                </div>
              )}

              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Upload Excel Assessment</h3>
                <p className="text-gray-600 mb-4">Select an Excel file (.xlsx or .xls) containing your assessment data</p>
                <div className="flex justify-center">
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="hidden" />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading}
                    className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center">
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      'Choose File'
                    )}
                  </button>
                </div>
                {file && <p className="mt-2 text-sm text-green-600">Selected: {file.name}</p>}
              </div>
            </div>
          )}

          {/* Step 2: Language Selection */}
          {step === 2 && jsonData && (
            <div className="space-y-6">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center mb-2">
                  <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
                  <h3 className="font-semibold text-green-800">File Processed Successfully</h3>
                </div>
                <p className="text-green-700 text-sm">
                  Found {jsonData.rows.length} rows with {jsonData.headers.length} columns
                </p>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Target Languages</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {supportedLanguages.map((lang) => (
                    <label
                      key={lang.code}
                      className={`p-3 border rounded-lg cursor-pointer transition-all hover:shadow-md
                        ${selectedLanguages.includes(lang.code) ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <input
                        type="checkbox"
                        checked={selectedLanguages.includes(lang.code)}
                        onChange={() => handleLanguageSelection(lang.code)}
                        className="sr-only"
                      />
                      <div className="text-sm font-medium text-gray-900">{lang.name}</div>
                      <div className="text-xs text-gray-600">{lang.native}</div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-between">
                <button
                  onClick={resetTool}
                  disabled={loading}
                  className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  Reset
                </button>
                <button
                  onClick={translateAssessment}
                  disabled={selectedLanguages.length === 0 || loading}
                  className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center">
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Translating...
                    </>
                  ) : (
                    'Start Translation'
                  )}
                </button>
                </div>
            </div>
          )}

          {/* Step 3: Translation Progress */}
          {step === 3 && (
            <div className="text-center py-12">
              <Loader2 className="h-12 w-12 text-blue-600 mx-auto mb-4 animate-spin" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Translating Content</h3>
              <p className="text-gray-600">Please wait while we translate your assessment into {selectedLanguages.length} languages using Google Translate...</p>
            </div>
          )}

          {/* Step 4: Results */}
          {step === 4 && Object.keys(translatedData).length > 0 && (
            <div className="space-y-6">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center mb-2">
                  <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
                  <h3 className="font-semibold text-green-800">Translation Complete!</h3>
                </div>
                <p className="text-green-700 text-sm">Your assessment has been successfully translated into {selectedLanguages.length} languages</p>
              </div>

              <div className="space-y-6">
                {selectedLanguages.map((langCode) => {
                  const lang = supportedLanguages.find((l) => l.code === langCode);
                  const data = translatedData[langCode];

                  return (
                    <div key={langCode} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-lg font-semibold text-gray-900">
                          {lang?.name} ({lang?.native})
                        </h4>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => downloadCSV(langCode)}
                            className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors flex items-center text-sm">
                            <Download className="h-4 w-4 mr-1" />
                            Download CSV
                          </button>
                          <button
                            onClick={() => copyToClipboard(langCode)}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center text-sm">
                            <FileText className="h-4 w-4 mr-1" />
                            Copy Data
                          </button>
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="bg-gray-50">
                              {data?.headers.map((header, index) => (
                                <th key={index} className="px-3 py-2 text-left font-medium text-gray-900 border-b whitespace-nowrap min-w-[120px]">
                                  {header}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {data?.rows.slice(0, 5).map((row, rowIndex) => (
                              <tr key={rowIndex} className="hover:bg-gray-50">
                                {data.headers.map((header, colIndex) => (
                                  <td key={colIndex} className="px-3 py-2 border-b text-gray-700 whitespace-nowrap min-w-[120px] max-w-[300px]">
                                    <div className="truncate" title={row[header] || ''}>
                                      {row[header] || ''}
                                    </div>
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {data?.rows.length > 5 && (
                          <p className="text-sm text-gray-500 mt-2 text-center">Showing first 5 rows of {data.rows.length} total rows</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-between items-center">
                <button onClick={resetTool} className="bg-gray-600 text-white px-6 py-2 rounded-lg hover:bg-gray-700 transition-colors">
                  Translate Another File
                </button>
                <button 
                  onClick={downloadAllExcel}
                  className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition-colors flex items-center">
                  <Download className="h-4 w-4 mr-2" />
                  Download All as Excel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GoogleTranslateAssessmentTool;